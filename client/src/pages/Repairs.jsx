import { useEffect, useMemo, useRef, useState } from 'react';
import { api, addressLine, aurl } from '../lib/api.js';
import { compressPhoto, uuid } from '../lib/device.js';
import { go } from '../lib/nav.js';
import { REPAIR_TYPES, REPAIR_STATUS, REPAIR_CLOSED, ITEMS_MAX } from '../../../shared/repairs.js';
import { contactError } from '../../../shared/contact.js';
import { Empty, Field, Section } from '../components/ui.jsx';
import ContactFields from '../components/ContactFields.jsx';
import RepairItems, { blankItem, itemsProblem, itemsPayload } from '../components/RepairItems.jsx';
import CardCamera, { liveCamera } from '../components/CardCamera.jsx';

const VIEWS = { list: 'รายการ', report: 'รายงาน', new: '➕ รับของที่ศูนย์' };
const contactLine = (r) => [r.phone, r.line && `LINE ${r.line}`, r.email].filter(Boolean).join(' · ') || 'ไม่มีช่องทางติดต่อ';
const statusTone = (s) => (REPAIR_CLOSED.includes(s) ? 'bg-neutral-200' : s === 'done' ? 'bg-lvgreen text-white' : 'bg-goldpale');

function Filters({ f, setF }) {
  return (
    <div className="flex flex-wrap gap-2 text-sm items-center print:hidden">
      <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="w-auto py-1.5">
        <option value="">ทุกประเภท</option>
        {Object.entries(REPAIR_TYPES).map(([k, l]) => <option key={k} value={k}>{k} {l}</option>)}
      </select>
      <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className="w-auto py-1.5">
        <option value="">ทุกสถานะ</option>
        {Object.entries(REPAIR_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <label className="flex items-center gap-2"><input type="checkbox" checked={f.open} onChange={(e) => setF({ ...f, open: e.target.checked })} />ยังไม่ปิดงาน</label>
      <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="ค้นหาเลขคิว ชื่อ เบอร์" className="flex-1 min-w-40 py-1.5" />
    </div>
  );
}

function List({ rows }) {
  if (!rows.length) return <Empty>ไม่มีรายการ</Empty>;
  return rows.map((r) => (
    <a key={r.id} href={`#/repair/${r.id}`} className="card flex items-center gap-3">
      {r.photos[0] ? <img src={aurl(`api/repair-photos/${r.photos[0]}`)} alt="" loading="lazy" className="w-16 h-16 object-cover rounded-lg shrink-0" />
        : <div className="w-16 h-16 rounded-lg bg-neutral-100 shrink-0" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-lg font-bold">{r.queue}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs ${statusTone(r.status)}`}>{REPAIR_STATUS[r.status]}</span>
        </div>
        <div className="text-sm truncate">{r.type_label}{r.type_other ? ` (${r.type_other})` : ''}{r.brand ? ` · ${r.brand}` : ''}</div>
        <div className="text-sm text-neutral-500 truncate">{r.owner_name} · {contactLine(r)}</div>
      </div>
    </a>
  ));
}

// Grouped by type, in queue order: the printable report. Every row leads back to the owner.
function Report({ rows, query }) {
  const groups = Object.keys(REPAIR_TYPES).map((t) => ({ t, items: rows.filter((r) => r.type === t) })).filter((g) => g.items.length);
  const counts = Object.keys(REPAIR_STATUS).map((s) => [s, rows.filter((r) => r.status === s).length]).filter(([, n]) => n);
  return (
    <div className="space-y-3">
      <div className="flex gap-2 print:hidden">
        <button type="button" onClick={() => window.print()} className="btn-gold flex-1">🖨️ พิมพ์</button>
        <a href={aurl(`api/repairs/report.csv?${query}`)} className="btn-ghost flex-1">⬇️ ดาวน์โหลด CSV</a>
      </div>
      <div className="card">
        <h2 className="font-bold text-lg">รายงานศูนย์ซ่อม · {new Date().toLocaleDateString('th-TH', { dateStyle: 'long' })}</h2>
        <div className="text-sm">ทั้งหมด {rows.length} ชิ้น{counts.length > 0 && ` · ${counts.map(([s, n]) => `${REPAIR_STATUS[s]} ${n}`).join(' · ')}`}</div>
      </div>
      {groups.length === 0 && <Empty>ไม่มีรายการ</Empty>}
      {groups.map(({ t, items }) => (
        <div key={t} className="card p-0 overflow-x-auto break-inside-avoid-page">
          <h3 className="font-bold px-3 pt-3">{t} · {REPAIR_TYPES[t]} ({items.length})</h3>
          <table className="w-full text-sm mt-2">
            <thead className="bg-neutral-100 text-left">
              <tr><th className="p-2">เลขคิว</th><th className="p-2">เจ้าของ / ติดต่อ</th><th className="p-2">พื้นที่</th><th className="p-2">รายละเอียด</th><th className="p-2">สถานะ</th></tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="p-2 font-bold whitespace-nowrap"><a href={`#/repair/${r.id}`}>{r.queue}</a></td>
                  <td className="p-2">{r.owner_name}<div className="text-neutral-500">{contactLine(r)}</div></td>
                  <td className="p-2">{addressLine(r.area) || '—'}</td>
                  <td className="p-2">{[r.type_other, r.brand, r.problem].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="p-2 whitespace-nowrap">{REPAIR_STATUS[r.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

const blankOwner = () => ({ uuid: uuid(), first_name: '', last_name: '', phone: '', line: '', email: '', no_contact: false,
  area: { house_no: '', moo: '', village: '', tambon: '', amphoe: '', province: '' } });

const SCAN_ERRORS = { 422: 'อ่านชื่อจากรูปไม่ได้ ถ่ายใหม่ให้เห็นด้านหน้าบัตรเต็มใบ ไม่สะท้อนแสง หรือพิมพ์เอง',
  429: 'สแกนถี่เกินไป รอสักครู่', 503: 'ยังไม่ได้เปิดใช้การสแกนบัตรบนเซิร์ฟเวอร์' };

// Photo of the ID card front → name and address filled in, and a code of the ID number for the one-item rule.
// The server reads it with a vision model and keeps nothing; the number itself never reaches the phone.
function IdCardScan({ onRead, notify }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [noCamera, setNoCamera] = useState(false); // live camera refused or missing: use the file input from now on
  const pick = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f); };
  const start = () => (liveCamera() && !noCamera ? setCamera(true) : input.current.click());
  const read = async (f) => {
    if (!navigator.onLine) return notify('ต้องมีสัญญาณเพื่อสแกนบัตร');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('photo', await compressPhoto(f, 1600, 0.85), 'card.jpg');
      onRead(await api('api/repairs/idcard', { method: 'POST', body: fd }));
      notify('อ่านบัตรแล้ว ตรวจช่องสีเหลืองให้ตรงกับบัตร');
    } catch (err) { notify(SCAN_ERRORS[err.status] || 'อ่านบัตรไม่สำเร็จ ลองใหม่หรือพิมพ์เอง'); }
    setBusy(false);
  };
  return (
    <div className="space-y-1">
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
      {camera && <CardCamera onShot={(b) => { setCamera(false); read(b); }} onClose={() => setCamera(false)}
        onFail={() => { setCamera(false); setNoCamera(true); notify('เปิดกล้องไม่ได้ กดสแกนอีกครั้งเพื่อถ่ายหรือเลือกรูป'); }} />}
      <button type="button" disabled={busy} onClick={start} className="btn-ghost w-full">
        {busy ? 'กำลังอ่านบัตร…' : '📷 สแกนบัตรประชาชน (กรอกชื่อและที่อยู่ให้)'}
      </button>
      <p className="text-xs text-neutral-500">ขออนุญาตเจ้าของก่อนถ่าย ถ่ายด้านหน้าบัตรให้เต็มใบ ระบบกรอกชื่อและที่อยู่ให้ และใช้เลขบัตรตรวจสิทธิ์
        1 ชิ้นต่อคน โดยเก็บเป็นรหัสที่ย้อนกลับเป็นเลขบัตรไม่ได้ ไม่เก็บรูปบัตร เลขประจำตัวประชาชน หรือวันเกิด</p>
    </div>
  );
}

const itemsLine = (list) => list.map((i) => `${i.queue} ${i.type_label}`).join(' · ');

// Whether this owner may still register: from the card scan, or the server's answer when saving.
function Entitlement({ scan, blocked, idcard }) {
  const earlier = blocked || scan?.already;
  if (earlier?.length) {
    return <p className="rounded-lg bg-lvred/10 border border-lvred text-lvred text-sm p-2">⛔ ลงทะเบียนแล้ว (สิทธิ์ 1 ชิ้นต่อคน): <b>{itemsLine(earlier)}</b></p>;
  }
  if (!scan) return idcard ? <p className="text-xs text-neutral-500">ยังไม่ได้สแกนบัตร: ระบบตรวจสิทธิ์จากชื่อและนามสกุลแทน</p> : null;
  if (!scan.id_code) return <p className="rounded-lg bg-goldpale text-sm p-2">อ่านเลขบัตรไม่ชัด: ถ่ายใหม่เพื่อตรวจสิทธิ์ด้วยบัตร (ถ้าไม่ถ่ายใหม่ ระบบตรวจจากชื่อแทน)</p>;
  return <p className="rounded-lg bg-lvgreen/10 text-sm p-2">✓ ตรวจบัตรแล้ว ยังไม่เคยลงทะเบียนในกิจกรรมนี้</p>;
}

// Walk-in: the owner brings items to the centre. Needs signal, so the queue numbers come back at once.
// One item per person (by ID card, or by name without a scan); the activity's leads may allow more, with a reason.
function WalkIn({ notify, onSaved, idcard, lead }) {
  const [o, setO] = useState(blankOwner);
  const [scan, setScan] = useState(null); // { id_code, already } from the last card scan
  const [blocked, setBlocked] = useState(null); // earlier items the server reported when saving
  const [ov, setOv] = useState({ on: false, reason: '' }); // lead's exception
  const [scanned, setScanned] = useState({}); // fields filled from the card, highlighted until edited
  const [items, setItems] = useState([blankItem()]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (p) => { if ('first_name' in p || 'last_name' in p) setBlocked(null); setO((s) => ({ ...s, ...p })); setScanned((x) => ({ ...x, ...Object.fromEntries(Object.keys(p).map((k) => [k, false])) })); };
  const setArea = (k, v) => { setO((s) => ({ ...s, area: { ...s.area, [k]: v } })); setScanned((x) => ({ ...x, [k]: false })); };
  const fromCard = (c) => {
    const top = Object.fromEntries(['first_name', 'last_name'].filter((k) => c[k]).map((k) => [k, c[k]]));
    const area = Object.fromEntries(['house_no', 'moo', 'tambon', 'amphoe', 'province'].filter((k) => c[k]).map((k) => [k, c[k]]));
    setO((s) => ({ ...s, ...top, area: { ...s.area, ...area } }));
    setScanned(Object.fromEntries([...Object.keys(top), ...Object.keys(area)].map((k) => [k, true])));
    setScan({ id_code: c.id_code || null, already: c.already || [] });
    setBlocked(null);
  };
  const maxItems = lead && ov.on ? ITEMS_MAX : 1;
  const hl = (k) => (scanned[k] ? 'bg-goldpale! border-golddark!' : '');

  const submit = async (e) => {
    e.preventDefault();
    if (!o.first_name.trim() || !o.last_name.trim()) return notify('กรุณากรอกชื่อและนามสกุลเจ้าของ');
    const ce = contactError(o);
    if (ce) return notify(ce);
    if (!items.length) return notify('เพิ่มสิ่งของอย่างน้อย 1 ชิ้น');
    const ip = itemsProblem(items);
    if (ip) return notify(ip);
    if (items.length > maxItems) return notify('รับได้ 1 ชิ้นต่อคน');
    if (lead && ov.on && !ov.reason.trim()) return notify('ใส่เหตุผลที่อนุญาตเกินสิทธิ์');
    if (!(lead && ov.on) && (blocked || scan?.already)?.length) return notify('เจ้าของรายนี้ลงทะเบียนครบสิทธิ์แล้ว');
    if (!navigator.onLine) return notify('ต้องมีสัญญาณเพื่อออกเลขคิว');
    setBusy(true);
    const fd = new FormData();
    fd.append('data', JSON.stringify({ ...o, items: itemsPayload(items), id_code: scan?.id_code || null,
      override: lead && ov.on ? { reason: ov.reason.trim() } : null }));
    for (const it of items) it.photos.forEach((p, i) => fd.append(`item_${it.uuid}`, p.blob, `item-${i + 1}.jpg`));
    try {
      const r = await api('api/repairs', { method: 'POST', body: fd });
      items.forEach((it) => it.photos.forEach((p) => URL.revokeObjectURL(p.url)));
      setDone({ name: `${o.first_name} ${o.last_name}`, items: r.items });
      setO(blankOwner()); setItems([blankItem()]); setScanned({}); setScan(null); setBlocked(null); setOv({ on: false, reason: '' }); onSaved();
    } catch (err) {
      if (err.status === 409 && err.body?.items) { setBlocked(err.body.items); notify('เจ้าของรายนี้ลงทะเบียนครบสิทธิ์แล้ว'); }
      else notify(err.status ? `บันทึกไม่สำเร็จ: ${err.message}` : 'ส่งไม่สำเร็จ ตรวจสอบสัญญาณแล้วลองใหม่');
    }
    setBusy(false);
  };

  if (done) {
    return (
      <div className="card text-center space-y-3">
        <div className="text-neutral-500">ลงทะเบียนแล้ว · {done.name}</div>
        <div className="text-sm">เขียนเลขคิวติดที่สิ่งของ และแจ้งเจ้าของให้จดไว้</div>
        <div className="flex flex-wrap justify-center gap-2">
          {done.items.map((i) => <a key={i.id} href={`#/repair/${i.id}`} className="rounded-xl bg-ink text-gold text-3xl font-bold px-4 py-3">{i.queue}</a>)}
        </div>
        <button type="button" onClick={() => setDone(null)} className="btn-primary w-full">รับของรายต่อไป</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Section title="เจ้าของ">
        {idcard && <IdCardScan onRead={fromCard} notify={notify} />}
        <Entitlement scan={scan} blocked={blocked} idcard={idcard} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="ชื่อ *"><input className={hl('first_name')} value={o.first_name} onChange={(e) => set({ first_name: e.target.value })} /></Field>
          <Field label="นามสกุล *"><input className={hl('last_name')} value={o.last_name} onChange={(e) => set({ last_name: e.target.value })} /></Field>
        </div>
        <ContactFields v={o} set={set} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="บ้านเลขที่"><input className={hl('house_no')} value={o.area.house_no} onChange={(e) => setArea('house_no', e.target.value)} /></Field>
          <Field label="หมู่ที่"><input className={hl('moo')} inputMode="numeric" value={o.area.moo} onChange={(e) => setArea('moo', e.target.value)} /></Field>
          <Field label="หมู่บ้าน" className="col-span-2"><input value={o.area.village} onChange={(e) => setArea('village', e.target.value)} /></Field>
          <Field label="ตำบล"><input className={hl('tambon')} value={o.area.tambon} onChange={(e) => setArea('tambon', e.target.value)} /></Field>
          <Field label="อำเภอ"><input className={hl('amphoe')} value={o.area.amphoe} onChange={(e) => setArea('amphoe', e.target.value)} /></Field>
          <Field label="จังหวัด" className="col-span-2"><input className={hl('province')} value={o.area.province} onChange={(e) => setArea('province', e.target.value)} /></Field>
        </div>
      </Section>
      <Section title="สิ่งของ" hint="1 ชิ้นต่อคน ถ่ายรูปตอนรับเข้า">
        <RepairItems items={items} onChange={setItems} notify={notify} max={maxItems} />
        {lead && (
          <div className="space-y-2 rounded-lg border border-neutral-200 p-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ov.on} onChange={(e) => setOv({ ...ov, on: e.target.checked })} />
              อนุญาตเกินสิทธิ์ 1 ชิ้นต่อคน (ผู้จัดการ)</label>
            {ov.on && <input value={ov.reason} onChange={(e) => setOv({ ...ov, reason: e.target.value })} placeholder="เหตุผล เช่น ปั๊มน้ำที่ต้องใช้ในบ้าน" />}
          </div>
        )}
      </Section>
      <button disabled={busy} className="btn-primary w-full text-lg py-4">{busy ? 'กำลังบันทึก…' : 'ลงทะเบียนและออกเลขคิว'}</button>
    </form>
  );
}

export default function Repairs({ notify, view = 'list', idcard = false, lead = false }) {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ type: '', status: '', open: false, q: '' });
  const query = useMemo(() => new URLSearchParams({ ...(f.type && { type: f.type }), ...(f.status && { status: f.status }),
    ...(f.open && { open: '1' }), ...(f.q && { q: f.q }) }).toString(), [f]);
  const load = () => api(`api/repairs?${query}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { if (view !== 'new') load(); }, [query, view]);

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold px-1 print:hidden">🔧 ศูนย์ซ่อม</h1>
      <div className="flex gap-2 text-sm print:hidden">
        {Object.entries(VIEWS).map(([k, l]) => (
          <button key={k} type="button" onClick={() => go(`/repairs?view=${k}`)} className={`rounded-full px-3 py-1.5 ${view === k ? 'bg-ink text-white' : 'bg-white'}`}>{l}</button>
        ))}
      </div>
      {view === 'new' ? <WalkIn notify={notify} onSaved={load} idcard={idcard} lead={lead} /> : (
        <>
          <Filters f={f} setF={setF} />
          {rows === null ? <Empty>กำลังโหลด…</Empty> : view === 'report' ? <Report rows={rows} query={query} /> : <List rows={rows} />}
          {rows && view === 'list' && <div className="text-xs text-neutral-500 px-1">{rows.length} ชิ้น</div>}
        </>
      )}
    </div>
  );
}
