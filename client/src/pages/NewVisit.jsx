import { useEffect, useMemo, useState } from 'react';
import { NEEDS, CATEGORIES, triage, ticketsFor, LEVEL_LABELS, RELIEF_CASES, RESIDENCE_TYPES, EVIDENCE } from '../../../shared/triage.js';
import { Section, Field, Check, Radio, LevelBadge } from '../components/ui.jsx';
import { getPosition, compressPhoto, uuid } from '../lib/device.js';
import { enqueue } from '../lib/outbox.js';
import { mapsLink, validThaiId } from '../lib/api.js';
import { go } from '../lib/nav.js';

// The area fields are remembered between visits: volunteers usually work one tambon at a time.
const AREA_KEYS = ['moo', 'village', 'tambon', 'amphoe', 'province'];
const loadArea = () => { try { return JSON.parse(localStorage.getItem('area') || '{}'); } catch { return {}; } };

const blank = () => ({
  uuid: uuid(),
  consent: false,
  title: '', first_name: '', last_name: '', age: '', national_id: '', phone: '',
  residence_type: 'registered', residence_other: '',
  address: { house_no: '', floor: '', soi: '', road: '', ...loadArea() },
  answers: { needs: [], cannot_travel: false, other_need: '' },
  override_level: '', override_reason: '',
  flood_from: '', flood_to: '', relief_case: '', damage_desc: '', promptpay: '', evidence: ['id_card'],
  notes: '',
});

export default function NewVisit({ notify }) {
  const [v, setV] = useState(blank);
  const [pos, setPos] = useState(null);
  const [posErr, setPosErr] = useState(null);
  const [locating, setLocating] = useState(false);
  const [photos, setPhotos] = useState([]); // { blob, url }
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

  const addPhotos = async (files) => {
    const added = [];
    for (const f of files) {
      try { const blob = await compressPhoto(f); added.push({ blob, url: URL.createObjectURL(blob) }); }
      catch { notify('ไม่สามารถอ่านรูปภาพนี้ได้'); }
    }
    setPhotos((p) => [...p, ...added].slice(0, 10));
  };

  const idInvalid = v.national_id && !validThaiId(v.national_id);

  const submit = async (e) => {
    e.preventDefault();
    if (!v.answers.needs.length && !v.answers.other_need.trim() && !v.override_level) return notify('กรุณาเลือกความต้องการอย่างน้อย 1 ข้อ');
    if (v.override_level && !v.override_reason.trim()) return notify('กรุณาระบุเหตุผลที่ปรับระดับ');
    if (!pos && !confirm('ยังไม่มีตำแหน่ง GPS บันทึกต่อหรือไม่?')) return;
    setSaving(true);
    try {
      localStorage.setItem('area', JSON.stringify(Object.fromEntries(AREA_KEYS.map((k) => [k, v.address[k]]))));
    } catch { /* ignore */ }
    const data = {
      ...v,
      ...(pos || {}),
      visited_at: new Date().toISOString(),
      override_level: v.override_level || null,
      ...(v.consent ? {} : { national_id: '', phone: '' }),
    };
    const saved = await enqueue(data, photos.map((p) => p.blob));
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setSaving(false);
    notify(saved.length ? 'บันทึกและส่งแล้ว' : 'บันทึกไว้ในเครื่องแล้ว จะส่งอัตโนมัติเมื่อมีสัญญาณ');
    setV(blank()); setPhotos([]); window.scrollTo(0, 0);
    go('/visits');
  };

  const byCat = Object.keys(CATEGORIES).filter((c) => c !== 'general').map((c) => ({ cat: c, items: NEEDS.filter((n) => n.cat === c) }));

  return (
    <form onSubmit={submit} className="space-y-3">
      <h1 className="text-xl font-bold px-1">บันทึกการเยี่ยมบ้าน</h1>

      <Section title="1. ตำแหน่งบ้าน">
        {pos ? (
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
        <button type="button" onClick={locate} disabled={locating} className="btn-ghost w-full">
          {locating ? 'กำลังหาตำแหน่ง…' : pos ? 'หาตำแหน่งใหม่' : 'ใช้ตำแหน่งปัจจุบัน'}
        </button>
      </Section>

      <Section title="2. ความต้องการ" hint="ถามด้วยความเห็นอกเห็นใจ เลือกทุกข้อที่พบ">
        {byCat.map(({ cat, items }) => (
          <div key={cat} className="space-y-2">
            <div className="font-semibold">{CATEGORIES[cat].icon} {CATEGORIES[cat].label}</div>
            {items.map((n) => (
              <Check key={n.id} checked={v.answers.needs.includes(n.id)} onChange={(on) => toggleNeed(n.id, on)} dot={cat === 'basic' ? null : n.level}>
                {n.label}
              </Check>
            ))}
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

      <Section title="3. ข้อมูลผู้ประสบภัย">
        <Check checked={v.consent} onChange={(on) => set({ consent: on })}>
          <b>ผู้ประสบภัยยินยอมให้เก็บข้อมูลส่วนบุคคล</b>
          <div className="text-sm text-neutral-500">เลขบัตรประชาชนและเบอร์โทรใช้เพื่อประสานความช่วยเหลือและกรอกแบบคำร้องขอรับเงินช่วยเหลือเท่านั้น</div>
        </Check>
        <div className="grid grid-cols-3 gap-2">
          <Field label="คำนำหน้า">
            <select value={v.title} onChange={(e) => set({ title: e.target.value })}>
              <option value="">-</option>
              {['นาย', 'นาง', 'นางสาว', 'ด.ช.', 'ด.ญ.'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="ชื่อ" className="col-span-2"><input value={v.first_name} onChange={(e) => set({ first_name: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="นามสกุล" className="col-span-2"><input value={v.last_name} onChange={(e) => set({ last_name: e.target.value })} /></Field>
          <Field label="อายุ"><input inputMode="numeric" value={v.age} onChange={(e) => set({ age: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></Field>
        </div>
        {v.consent && (
          <>
            <Field label="เลขประจำตัวประชาชน 13 หลัก">
              <input inputMode="numeric" value={v.national_id} onChange={(e) => set({ national_id: e.target.value.replace(/\D/g, '').slice(0, 13) })} />
              {idInvalid && v.national_id.length === 13 && <span className="text-sm text-lvred">เลขบัตรไม่ถูกต้อง กรุณาตรวจสอบ</span>}
            </Field>
            <Field label="หมายเลขโทรศัพท์">
              <input type="tel" inputMode="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} />
            </Field>
          </>
        )}
      </Section>

      <Section title="4. ที่อยู่อาศัยประจำ">
        <div className="space-y-2">
          {Object.entries(RESIDENCE_TYPES).map(([k, l]) => (
            <Radio key={k} name="rt" value={k} current={v.residence_type} onChange={(val) => set({ residence_type: val })}>{l}</Radio>
          ))}
          {v.residence_type === 'other' && <input value={v.residence_other} onChange={(e) => set({ residence_other: e.target.value })} placeholder="ระบุ" />}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="บ้านเลขที่"><input value={v.address.house_no} onChange={(e) => setAddr('house_no', e.target.value)} /></Field>
          <Field label="หมู่ที่/ชุมชน"><input value={v.address.moo} onChange={(e) => setAddr('moo', e.target.value)} /></Field>
          <Field label="หมู่บ้าน/คอนโด"><input value={v.address.village} onChange={(e) => setAddr('village', e.target.value)} /></Field>
          <Field label="ชั้น"><input value={v.address.floor} onChange={(e) => setAddr('floor', e.target.value)} /></Field>
          <Field label="ซอย"><input value={v.address.soi} onChange={(e) => setAddr('soi', e.target.value)} /></Field>
          <Field label="ถนน"><input value={v.address.road} onChange={(e) => setAddr('road', e.target.value)} /></Field>
          <Field label="ตำบล"><input value={v.address.tambon} onChange={(e) => setAddr('tambon', e.target.value)} /></Field>
          <Field label="อำเภอ"><input value={v.address.amphoe} onChange={(e) => setAddr('amphoe', e.target.value)} /></Field>
          <Field label="จังหวัด" className="col-span-2"><input value={v.address.province} onChange={(e) => setAddr('province', e.target.value)} /></Field>
        </div>
      </Section>

      <Section title="5. รูปถ่าย" hint="ความเสียหายของบ้านและทรัพย์สิน (สูงสุด 10 รูป)">
        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div key={p.url} className="relative">
                <img src={p.url} alt="" className="aspect-square w-full object-cover rounded-lg" />
                <button type="button" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}
                  className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/60 text-white">✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="btn-gold cursor-pointer">📷 ถ่ายรูป
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addPhotos([...e.target.files]); e.target.value = ''; }} />
          </label>
          <label className="btn-ghost cursor-pointer">🖼️ เลือกจากคลัง
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addPhotos([...e.target.files]); e.target.value = ''; }} />
          </label>
        </div>
      </Section>

      <details className="card">
        <summary className="font-bold text-lg cursor-pointer">6. ข้อมูลสำหรับแบบคำร้องขอรับเงินช่วยเหลือ <span className="text-sm font-normal text-neutral-500">(ถ้าต้องการ)</span></summary>
        <div className="space-y-3 mt-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="น้ำท่วมตั้งแต่วันที่"><input type="date" value={v.flood_from} onChange={(e) => set({ flood_from: e.target.value })} /></Field>
            <Field label="ถึงวันที่"><input type="date" value={v.flood_to} onChange={(e) => set({ flood_to: e.target.value })} /></Field>
          </div>
          <div className="space-y-2">
            <span className="label">กรณีขอรับความช่วยเหลือ</span>
            {Object.entries(RELIEF_CASES).map(([k, l]) => (
              <Radio key={k} name="rc" value={k} current={String(v.relief_case)} onChange={(val) => set({ relief_case: val })}>
                <b>กรณีที่ {k}</b> <span className="text-sm">{l}</span>
              </Radio>
            ))}
            {String(v.relief_case) === '1' && <input value={v.damage_desc} onChange={(e) => set({ damage_desc: e.target.value })} placeholder="ระบุทรัพย์สินที่เสียหาย" />}
          </div>
          <div className="space-y-2">
            <span className="label">พร้อมเพย์ผูกกับเลขบัตรประชาชน</span>
            <div className="grid grid-cols-2 gap-2">
              <Radio name="pp" value="yes" current={v.promptpay} onChange={(val) => set({ promptpay: val })}>มี</Radio>
              <Radio name="pp" value="no" current={v.promptpay} onChange={(val) => set({ promptpay: val })}>ไม่มี</Radio>
            </div>
          </div>
          <div className="space-y-2">
            <span className="label">หลักฐานที่มี</span>
            {Object.entries(EVIDENCE).map(([k, l]) => (
              <Check key={k} checked={v.evidence.includes(k)} onChange={(on) => set({ evidence: on ? [...v.evidence, k] : v.evidence.filter((x) => x !== k) })}>{l}</Check>
            ))}
          </div>
        </div>
      </details>

      <Section title="7. หมายเหตุ">
        <textarea rows={3} value={v.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="ข้อสังเกตเพิ่มเติมสำหรับทีมผู้เชี่ยวชาญ" />
      </Section>

      <button disabled={saving} className="btn-primary w-full text-lg py-4">{saving ? 'กำลังบันทึก…' : 'บันทึกการเยี่ยมบ้าน'}</button>
    </form>
  );
}
