import { useEffect, useState } from 'react';
import { api, addressLine, timeAgo } from '../lib/api.js';
import { REPAIR_STATUS } from '../../../shared/repairs.js';
import { Empty, Section } from '../components/ui.jsx';

const Row = ({ k, children }) => (children ? <div className="flex gap-3 text-sm"><span className="w-24 shrink-0 text-neutral-500">{k}</span><span className="flex-1">{children}</span></div> : null);

export default function RepairDetail({ id, me, notify }) {
  const [r, setR] = useState(null);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api(`api/repairs/${id}`).then((x) => { setR(x); setStatus(x.status); }).catch(() => setR(false));
  useEffect(() => { load(); }, [id]);

  const save = async () => {
    setBusy(true);
    try { await api(`api/repairs/${id}/update`, { method: 'POST', body: { status, note } }); notify('บันทึกแล้ว'); setNote(''); load(); }
    catch (e) { notify(e.body?.error === 'nothing to update' ? 'เลือกสถานะใหม่หรือเขียนบันทึก' : 'บันทึกไม่สำเร็จ'); }
    setBusy(false);
  };

  if (r === null) return <Empty>กำลังโหลด…</Empty>;
  if (r === false) return <Empty>ไม่พบข้อมูล หรือไม่มีสิทธิ์เข้าถึง</Empty>;

  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-3xl font-bold">{r.queue}</div>
            <div>{r.type_label}{r.type_other ? ` (${r.type_other})` : ''}</div>
          </div>
          <span className="rounded-full bg-goldpale px-3 py-1 text-sm font-semibold">{REPAIR_STATUS[r.status]}</span>
        </div>
        <Row k="ยี่ห้อ/รุ่น">{r.brand}</Row>
        <Row k="อาการ">{r.problem}</Row>
        <Row k="ลงทะเบียน">{`${r.creator || ''} · ${timeAgo(r.created_at)}${r.visit_id ? '' : ' · รับที่ศูนย์'}`}</Row>
      </div>

      <Section title="เจ้าของ">
        <div className="font-semibold">{r.owner_name}</div>
        <Row k="พื้นที่">{addressLine(r.area)}</Row>
        <Row k="LINE">{r.line && <a className="text-golddark underline" href={`https://line.me/R/ti/p/~${encodeURIComponent(r.line)}`} target="_blank" rel="noreferrer">{r.line}</a>}</Row>
        <Row k="อีเมล">{r.email && <a className="text-golddark underline" href={`mailto:${r.email}`}>{r.email}</a>}</Row>
        <div className="grid grid-cols-2 gap-2">
          {r.phone ? <a className="btn-gold" href={`tel:${r.phone}`}>📞 {r.phone}</a> : <span className="text-sm text-neutral-500 self-center">ไม่มีเบอร์โทร</span>}
          {r.visit_id && me.role !== 'fixer' && <a className="btn-ghost" href={`#/visit/${r.visit_id}`}>บันทึกเยี่ยมบ้าน</a>}
        </div>
      </Section>

      <Section title={`รูปถ่าย (${r.photos.length})`}>
        <div className="grid grid-cols-3 gap-2">
          {r.photos.map((p) => (
            <a key={p} href={`api/repair-photos/${p}`} target="_blank" rel="noreferrer">
              <img src={`api/repair-photos/${p}`} alt="" loading="lazy" className="aspect-square w-full object-cover rounded-lg" />
            </a>
          ))}
        </div>
      </Section>

      {r.can_update && (
        <Section title="อัปเดตสถานะ">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(REPAIR_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="บันทึก เช่น เปลี่ยนคาปาซิเตอร์ ล้างคาร์บูเรเตอร์ นัดรับวันที่…" />
          <button disabled={busy} onClick={save} className="btn-primary w-full">บันทึก</button>
        </Section>
      )}

      {r.updates.length > 0 && (
        <Section title="ประวัติ">
          <ul className="text-sm space-y-1.5">
            {r.updates.map((u) => (
              <li key={u.id}><b>{REPAIR_STATUS[u.status] || u.status}</b> · {u.name} · {timeAgo(u.created_at)}{u.note && <div className="text-neutral-600">{u.note}</div>}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
