import { useEffect, useMemo, useState } from 'react';
import { api, addressLine } from '../lib/api.js';
import { uuid } from '../lib/device.js';
import { go } from '../lib/nav.js';
import { REPAIR_TYPES, REPAIR_STATUS, REPAIR_CLOSED } from '../../../shared/repairs.js';
import { contactError } from '../../../shared/contact.js';
import { Empty, Field, Section } from '../components/ui.jsx';
import ContactFields from '../components/ContactFields.jsx';
import RepairItems, { blankItem, itemsProblem, itemsPayload } from '../components/RepairItems.jsx';

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
      {r.photos[0] ? <img src={`api/repair-photos/${r.photos[0]}`} alt="" loading="lazy" className="w-16 h-16 object-cover rounded-lg shrink-0" />
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
        <a href={`api/repairs/report.csv?${query}`} className="btn-ghost flex-1">⬇️ ดาวน์โหลด CSV</a>
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
  area: { moo: '', village: '', tambon: '', amphoe: '', province: '' } });

// Walk-in: the owner brings items to the centre. Needs signal, so the queue numbers come back at once.
function WalkIn({ notify, onSaved }) {
  const [o, setO] = useState(blankOwner);
  const [items, setItems] = useState([blankItem()]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (p) => setO((s) => ({ ...s, ...p }));
  const setArea = (k, v) => setO((s) => ({ ...s, area: { ...s.area, [k]: v } }));

  const submit = async (e) => {
    e.preventDefault();
    if (!o.first_name.trim() || !o.last_name.trim()) return notify('กรุณากรอกชื่อและนามสกุลเจ้าของ');
    const ce = contactError(o);
    if (ce) return notify(ce);
    if (!items.length) return notify('เพิ่มสิ่งของอย่างน้อย 1 ชิ้น');
    const ip = itemsProblem(items);
    if (ip) return notify(ip);
    if (!navigator.onLine) return notify('ต้องมีสัญญาณเพื่อออกเลขคิว');
    setBusy(true);
    const fd = new FormData();
    fd.append('data', JSON.stringify({ ...o, items: itemsPayload(items) }));
    for (const it of items) it.photos.forEach((p, i) => fd.append(`item_${it.uuid}`, p.blob, `item-${i + 1}.jpg`));
    try {
      const r = await api('api/repairs', { method: 'POST', body: fd });
      items.forEach((it) => it.photos.forEach((p) => URL.revokeObjectURL(p.url)));
      setDone({ name: `${o.first_name} ${o.last_name}`, items: r.items });
      setO(blankOwner()); setItems([blankItem()]); onSaved();
    } catch (err) { notify(err.status ? `บันทึกไม่สำเร็จ: ${err.message}` : 'ส่งไม่สำเร็จ ตรวจสอบสัญญาณแล้วลองใหม่'); }
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
        <div className="grid grid-cols-2 gap-2">
          <Field label="ชื่อ *"><input value={o.first_name} onChange={(e) => set({ first_name: e.target.value })} /></Field>
          <Field label="นามสกุล *"><input value={o.last_name} onChange={(e) => set({ last_name: e.target.value })} /></Field>
        </div>
        <ContactFields v={o} set={set} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="หมู่ที่"><input value={o.area.moo} onChange={(e) => setArea('moo', e.target.value)} /></Field>
          <Field label="หมู่บ้าน"><input value={o.area.village} onChange={(e) => setArea('village', e.target.value)} /></Field>
          <Field label="ตำบล"><input value={o.area.tambon} onChange={(e) => setArea('tambon', e.target.value)} /></Field>
          <Field label="อำเภอ"><input value={o.area.amphoe} onChange={(e) => setArea('amphoe', e.target.value)} /></Field>
          <Field label="จังหวัด" className="col-span-2"><input value={o.area.province} onChange={(e) => setArea('province', e.target.value)} /></Field>
        </div>
      </Section>
      <Section title="สิ่งของ" hint="ถ่ายรูปทุกชิ้นตอนรับเข้า">
        <RepairItems items={items} onChange={setItems} notify={notify} />
      </Section>
      <button disabled={busy} className="btn-primary w-full text-lg py-4">{busy ? 'กำลังบันทึก…' : 'ลงทะเบียนและออกเลขคิว'}</button>
    </form>
  );
}

export default function Repairs({ notify, view = 'list' }) {
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
      {view === 'new' ? <WalkIn notify={notify} onSaved={load} /> : (
        <>
          <Filters f={f} setF={setF} />
          {rows === null ? <Empty>กำลังโหลด…</Empty> : view === 'report' ? <Report rows={rows} query={query} /> : <List rows={rows} />}
          {rows && view === 'list' && <div className="text-xs text-neutral-500 px-1">{rows.length} ชิ้น</div>}
        </>
      )}
    </div>
  );
}
