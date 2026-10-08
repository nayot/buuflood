import { useEffect, useMemo, useState } from 'react';
import { NEEDS, CATEGORIES, triage, ticketsFor, needsMentalScreening, LEVEL_LABELS } from '../../../shared/triage.js';
import { contactError } from '../../../shared/contact.js';
import { Section, Field, Check, LevelBadge } from '../components/ui.jsx';
import { getPosition, uuid } from '../lib/device.js';
import { enqueue } from '../lib/outbox.js';
import { api, mapsLink, geocode } from '../lib/api.js';
import PinPicker from '../components/PinPicker.jsx';
import MentalScreen, { blankMental } from '../components/MentalScreen.jsx';
import ContactFields from '../components/ContactFields.jsx';
import RepairItems, { itemsProblem, itemsPayload } from '../components/RepairItems.jsx';
import { go } from '../lib/nav.js';

// The area fields are remembered between visits: volunteers usually work one tambon at a time.
const AREA_KEYS = ['moo', 'village', 'tambon', 'amphoe', 'province'];
const loadArea = () => { try { return JSON.parse(localStorage.getItem('area') || '{}'); } catch { return {}; } };

const blank = () => ({
  uuid: uuid(),
  location_source: 'gps', // 'address' when the villager is met away from home
  first_name: '', last_name: '', phone: '', line: '', email: '', no_contact: false,
  address: { house_no: '', floor: '', soi: '', road: '', ...loadArea() },
  answers: { needs: [], cannot_travel: false, other_need: '', mental: blankMental() },
  line_referral: null, // { code, consent }: yellow mental result handed over to the BUU Flood Help LINE OA
  override_level: '', override_reason: '',
  notes: '',
});

export default function NewVisit({ me, notify }) {
  const [v, setV] = useState(blank);
  const [pos, setPos] = useState(null);
  const [posErr, setPosErr] = useState(null);
  const [locating, setLocating] = useState(false);
  const [pin, setPin] = useState(null);        // house position picked on the map (address mode)
  const [mapCenter, setMapCenter] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [finding, setFinding] = useState(false);
  const byAddress = v.location_source === 'address';
  const [items, setItems] = useState([]);   // repair items, see RepairItems.jsx
  const [saving, setSaving] = useState(false);

  const set = (patch) => setV((s) => ({ ...s, ...patch }));
  const setAddr = (k, val) => setV((s) => ({ ...s, address: { ...s.address, [k]: val } }));
  const setAns = (patch) => setV((s) => ({ ...s, answers: { ...s.answers, ...patch } }));
  const toggleNeed = (id, on) => setAns({ needs: on ? [...v.answers.needs, id] : v.answers.needs.filter((n) => n !== id) });

  const locate = async () => {
    setLocating(true); setPosErr(null);
    try { setPos(await getPosition()); } catch (e) { setPosErr(e.message); }
    setLocating(false);
  };
  useEffect(() => { locate(); }, []);

  const result = useMemo(() => triage(v.answers), [v.answers]);
  const level = v.override_level || result.level;
  const tickets = ticketsFor(result, v.override_level || null);

  const a = v.address;
  const mentalOn = needsMentalScreening(v.answers);
  const addressComplete = !!(a.tambon && a.amphoe && a.province && (a.house_no || a.moo));
  // LINE referral: offered for a yellow screening result (not with a crisis tick) when the server has LINE set up.
  const lineOffered = !!me?.line_oa && mentalOn && result.mental?.complete && result.mental.level === 'yellow' && !v.answers.needs.includes('m_crisis');
  const registerReferral = (code) => api('api/line-referrals', { method: 'POST', body: {
    code, consent: true, visit_uuid: v.uuid, first_name: v.first_name, last_name: v.last_name, phone: v.phone, line: v.line,
    address: v.address, mental: v.answers.mental } });

  const findOnMap = async () => {
    setShowMap(true); setFinding(true);
    const hit = await geocode(a);
    setMapCenter(hit || pos || null);
    if (!hit) notify(navigator.onLine ? 'หาที่อยู่บนแผนที่ไม่พบ เลื่อนแผนที่แล้วแตะตำแหน่งบ้าน' : 'ไม่มีสัญญาณ บันทึกด้วยที่อยู่ได้ ไม่ต้องปักหมุด');
    setFinding(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!v.answers.needs.length && !v.answers.other_need.trim() && !v.override_level) return notify('กรุณาเลือกความต้องการอย่างน้อย 1 ข้อ');
    if (v.override_level && !v.override_reason.trim()) return notify('กรุณาระบุเหตุผลที่ปรับระดับ');
    if (mentalOn && !result.mental?.complete) return notify('กรุณาทำแบบคัดกรองสุขภาพใจให้ครบในข้อ 4');
    if (lineOffered && v.line_referral && !v.line_referral.consent) return notify('ส่งต่อทาง LINE: ติ๊กความยินยอมของผู้ประสบภัย หรือยกเลิกการส่งต่อ');
    if (!v.first_name.trim() || !v.last_name.trim()) return notify('กรุณากรอกชื่อและนามสกุลของผู้ประสบภัย');
    const ce = contactError(v);
    if (ce) return notify(ce);
    if (byAddress && !addressComplete) return notify('ใช้ที่อยู่ระบุตำแหน่ง: กรุณากรอกบ้านเลขที่หรือหมู่ ตำบล อำเภอ จังหวัด ในข้อ 3');
    const ip = itemsProblem(items);
    if (ip) return notify(ip);
    if (!byAddress && !pos && !confirm('ยังไม่มีตำแหน่ง GPS บันทึกต่อหรือไม่?')) return;
    setSaving(true);
    try {
      localStorage.setItem('area', JSON.stringify(Object.fromEntries(AREA_KEYS.map((k) => [k, v.address[k]]))));
    } catch { /* ignore */ }
    const { mental, ...answers } = v.answers;
    const data = {
      ...v,
      answers: mentalOn ? { ...answers, mental } : answers,
      line_referral: lineOffered && v.line_referral?.consent ? { code: v.line_referral.code, consent: true } : null,
      items: itemsPayload(items),
      // House position: GPS at the house, or the map pin (or none) when located by address.
      ...(byAddress ? { lat: pin?.lat ?? null, lng: pin?.lng ?? null, accuracy: null } : (pos || {})),
      here: pos, // where the volunteer is, for the safety check-in
      visited_at: new Date().toISOString(),
      override_level: v.override_level || null,
    };
    const saved = await enqueue(data, [], Object.fromEntries(items.map((it) => [it.uuid, it.photos.map((p) => p.blob)])));
    items.forEach((it) => it.photos.forEach((p) => URL.revokeObjectURL(p.url)));
    setSaving(false);
    // The outbox may upload older queued visits in the same go: pick this one by its uuid.
    const sent = saved.find((r) => r.uuid === data.uuid);
    const mine = sent?.repairs?.length ? sent : null;
    notify(!sent ? 'บันทึกไว้ในเครื่องแล้ว จะส่งอัตโนมัติเมื่อมีสัญญาณ'
      : mine ? `บันทึกแล้ว เลขคิวซ่อม: ${mine.repairs.map((r) => r.queue).join(', ')}` : 'บันทึกและส่งแล้ว');
    setV(blank()); setItems([]); setPin(null); setShowMap(false); setMapCenter(null); window.scrollTo(0, 0);
    // With repair items, open the visit so the volunteer can tell the owner the queue numbers.
    go(mine ? `/visit/${mine.id}` : '/visits');
  };

  const byCat = Object.keys(CATEGORIES).filter((c) => c !== 'general').map((c) => ({ cat: c, list: NEEDS.filter((n) => n.cat === c) }));

  return (
    <form onSubmit={submit} className="space-y-3">
      <h1 className="text-xl font-bold px-1">บันทึกการเยี่ยมบ้าน</h1>

      <Section title="1. ตำแหน่งบ้าน">
        {byAddress ? null : pos ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-2xl">📍</span>
            <div className="flex-1">
              <div className="font-semibold">{pos.lat}, {pos.lng}</div>
              <div className="text-neutral-500">ความแม่นยำ ±{pos.accuracy} ม.</div>
            </div>
            <a href={mapsLink(pos.lat, pos.lng)} target="_blank" rel="noreferrer" className="text-golddark underline">ดูแผนที่</a>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">{locating ? 'กำลังหาตำแหน่ง…' : posErr || 'ยังไม่มีตำแหน่ง'}</p>
        )}
        {!byAddress && (
          <button type="button" onClick={locate} disabled={locating} className="btn-ghost w-full">
            {locating ? 'กำลังหาตำแหน่ง…' : pos ? 'หาตำแหน่งใหม่' : 'ใช้ตำแหน่งปัจจุบัน'}
          </button>
        )}
        <Check checked={byAddress} onChange={(on) => { set({ location_source: on ? 'address' : 'gps' }); if (!on) { setPin(null); setShowMap(false); } }}>
          <b>ไม่ได้พบที่บ้าน: ใช้ที่อยู่ระบุตำแหน่งบ้านแทน</b>
          <div className="text-sm text-neutral-500">เช่น พบที่ศูนย์พักพิง วัด หรือจุดบริการ ตำแหน่ง GPS ตอนนี้จะไม่ถูกใช้เป็นตำแหน่งบ้าน</div>
        </Check>
        {byAddress && (
          <div className="space-y-2">
            <p className={`text-sm ${addressComplete ? 'text-lvgreen' : 'text-lvred'}`}>
              {addressComplete ? '✓ ที่อยู่ครบ ทีมจะนำทางด้วยที่อยู่นี้' : 'กรอกบ้านเลขที่หรือหมู่ ตำบล อำเภอ จังหวัด ในข้อ 3 ให้ครบ'}
            </p>
            {!showMap ? (
              <button type="button" onClick={findOnMap} className="btn-ghost w-full">🗺️ ปักหมุดบ้านบนแผนที่ (ถ้าทราบ)</button>
            ) : (
              <>
                <p className="text-sm text-neutral-500">{finding ? 'กำลังค้นหาที่อยู่…' : 'แตะแผนที่ที่ตำแหน่งบ้าน (ถามผู้ประสบภัยให้ช่วยชี้)'}</p>
                <PinPicker pin={pin} center={mapCenter} onPick={setPin} />
                <div className="flex items-center justify-between text-sm">
                  <span>{pin ? `📍 ${pin.lat}, ${pin.lng}` : 'ยังไม่ได้ปักหมุด'}</span>
                  {pin && <button type="button" onClick={() => setPin(null)} className="text-golddark underline">ล้างหมุด</button>}
                </div>
              </>
            )}
          </div>
        )}
      </Section>

      <Section title="2. ผู้ประสบภัยและช่องทางติดต่อ" hint="แจ้งผู้ประสบภัยว่าข้อมูลใช้เพื่อประสานความช่วยเหลือเท่านั้น">
        <div className="grid grid-cols-2 gap-2">
          <Field label="ชื่อ *"><input required value={v.first_name} onChange={(e) => set({ first_name: e.target.value })} /></Field>
          <Field label="นามสกุล *"><input required value={v.last_name} onChange={(e) => set({ last_name: e.target.value })} /></Field>
        </div>
        <ContactFields v={v} set={set} />
      </Section>

      <Section title="3. ที่อยู่" hint={byAddress ? 'ไม่ได้พบที่บ้าน: ต้องกรอกบ้านเลขที่หรือหมู่ ตำบล อำเภอ จังหวัด เพื่อระบุตำแหน่งบ้าน' : null}>
        <div className="grid grid-cols-2 gap-2">
          <Field label={byAddress ? 'บ้านเลขที่ *' : 'บ้านเลขที่'}><input required={byAddress && !a.moo} value={v.address.house_no} onChange={(e) => setAddr('house_no', e.target.value)} /></Field>
          <Field label={byAddress ? 'หมู่ที่/ชุมชน *' : 'หมู่ที่/ชุมชน'}><input required={byAddress && !a.house_no} value={v.address.moo} onChange={(e) => setAddr('moo', e.target.value)} /></Field>
          <Field label="หมู่บ้าน/คอนโด"><input value={v.address.village} onChange={(e) => setAddr('village', e.target.value)} /></Field>
          <Field label="ชั้น"><input value={v.address.floor} onChange={(e) => setAddr('floor', e.target.value)} /></Field>
          <Field label="ซอย"><input value={v.address.soi} onChange={(e) => setAddr('soi', e.target.value)} /></Field>
          <Field label="ถนน"><input value={v.address.road} onChange={(e) => setAddr('road', e.target.value)} /></Field>
          <Field label={byAddress ? 'ตำบล *' : 'ตำบล'}><input required={byAddress} value={v.address.tambon} onChange={(e) => setAddr('tambon', e.target.value)} /></Field>
          <Field label={byAddress ? 'อำเภอ *' : 'อำเภอ'}><input required={byAddress} value={v.address.amphoe} onChange={(e) => setAddr('amphoe', e.target.value)} /></Field>
          <Field label={byAddress ? 'จังหวัด *' : 'จังหวัด'} className="col-span-2"><input required={byAddress} value={v.address.province} onChange={(e) => setAddr('province', e.target.value)} /></Field>
        </div>
      </Section>

      <Section title="4. ความต้องการ" hint="ถามด้วยความเห็นอกเห็นใจ เลือกทุกข้อที่พบ">
        {byCat.map(({ cat, list }) => (
          <div key={cat} className="space-y-2">
            <div className="font-semibold">{CATEGORIES[cat].icon} {CATEGORIES[cat].label}</div>
            {list.map((n) => (
              <Check key={n.id} checked={v.answers.needs.includes(n.id)} onChange={(on) => toggleNeed(n.id, on)} dot={cat === 'basic' || (cat === 'mental' && n.level !== 'red') ? null : n.level}>
                {n.label}
              </Check>
            ))}
            {cat === 'mental' && mentalOn && (
              <MentalScreen value={v.answers.mental} onChange={(mental) => setAns({ mental })} crisis={v.answers.needs.includes('m_crisis')}
                line={me?.line_oa ? { oa: me.line_oa, value: v.line_referral, onChange: (r) => set({ line_referral: r }), register: registerReferral } : null} />
            )}
          </div>
        ))}
        <Field label="ความต้องการอื่น ๆ">
          <input value={v.answers.other_need} onChange={(e) => setAns({ other_need: e.target.value })} placeholder="ระบุ (ถ้ามี)" />
        </Field>
        <Check checked={v.answers.cannot_travel} onChange={(on) => setAns({ cannot_travel: on })}>
          <b>เดินทางมาจุดบริการเองไม่ได้</b>
          <div className="text-sm text-neutral-500">เช่น ผู้สูงอายุ ไม่มีพาหนะ ทางยังถูกน้ำตัด</div>
        </Check>
      </Section>

      <section className={`card space-y-3 border-2 ${level === 'red' ? 'border-lvred' : level === 'yellow' ? 'border-lvyellow' : level === 'green' ? 'border-lvgreen' : 'border-transparent'}`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold text-lg">ผลการคัดกรอง</h2>
          <LevelBadge level={level} big />
        </div>
        {mentalOn && !result.mental?.complete && (
          <div className="text-sm text-golddark">ยังทำแบบคัดกรองสุขภาพใจไม่ครบ ระดับอาจเปลี่ยนเมื่อตอบครบ</div>
        )}
        {result.categories.mental?.level === 'red' && (
          <div className="rounded-lg bg-lvred text-white p-2 text-sm font-bold">🚨 สุขภาพใจระดับแดง: โทรขอความช่วยเหลือทันที (เบอร์โทรอยู่ในข้อ 4)</div>
        )}
        {result.reasons.length > 0 && (
          <ul className="text-sm list-disc pl-5 text-neutral-600">{result.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        )}
        {tickets.length > 0 && (
          <div className="text-sm">
            <span className="font-semibold">จะแจ้งทีม: </span>
            {tickets.map((t) => `${CATEGORIES[t.category].icon} ${CATEGORIES[t.category].label}`).join(' · ')}
          </div>
        )}
        <details>
          <summary className="text-sm text-golddark cursor-pointer">ปรับระดับเอง (ถ้าประเมินแล้วไม่ตรง)</summary>
          <div className="mt-2 space-y-2">
            <select value={v.override_level} onChange={(e) => set({ override_level: e.target.value })}>
              <option value="">ใช้ผลอัตโนมัติ</option>
              {['red', 'yellow', 'green'].map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
            </select>
            {v.override_level && (
              <input value={v.override_reason} onChange={(e) => set({ override_reason: e.target.value })} placeholder="เหตุผล (จำเป็น)" />
            )}
          </div>
        </details>
      </section>

      <Section title="5. สิ่งของที่ต้องซ่อม" hint="เช่น รถจักรยานยนต์ ตู้เย็น เครื่องซักผ้า โทรทัศน์ ต้องมีรูปถ่ายทุกชิ้น เลขคิวจะออกเมื่อส่งข้อมูลถึงระบบแล้ว">
        <RepairItems items={items} onChange={setItems} notify={notify} />
      </Section>

      <Section title="6. หมายเหตุ">
        <textarea rows={3} value={v.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="ข้อสังเกตเพิ่มเติมสำหรับทีมผู้เชี่ยวชาญ" />
      </Section>

      <button disabled={saving} className="btn-primary w-full text-lg py-4">{saving ? 'กำลังบันทึก…' : 'บันทึกการเยี่ยมบ้าน'}</button>
    </form>
  );
}
