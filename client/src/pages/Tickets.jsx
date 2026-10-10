import { useEffect, useState } from 'react';
import { api, addressLine, navLink, canLocate, timeAgo } from '../lib/api.js';
import { NEEDS, CATEGORIES, TICKET_STATUS, SPECIALTIES } from '../../../shared/triage.js';
import { LevelBadge, Empty, LEVEL_COLOR } from '../components/ui.jsx';

function TicketCard({ t, me, reload, notify }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(t.status === 'open' ? 'in_progress' : t.status);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const claim = async () => { setBusy(true); try { await api(`api/tickets/${t.id}/claim`, { method: 'POST' }); notify('รับเรื่องแล้ว'); reload(); } catch { notify('ไม่สำเร็จ'); } setBusy(false); };
  const update = async () => {
    setBusy(true);
    try { await api(`api/tickets/${t.id}/update`, { method: 'POST', body: { status, note } }); notify('อัปเดตแล้ว'); setOpen(false); setNote(''); reload(); }
    catch { notify('ไม่สำเร็จ'); }
    setBusy(false);
  };
  const mine = t.assignee_id === me.id;

  return (
    <div className="card space-y-2 border-l-8" style={{ borderLeftColor: LEVEL_COLOR[t.level] }}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold">{CATEGORIES[t.category]?.icon} {CATEGORIES[t.category]?.label}</div>
        <LevelBadge level={t.level} />
      </div>
      <a href={`#/visit/${t.visit_id}`} className="block">
        <div className="font-semibold">{t.name || 'ไม่ระบุชื่อ'}</div>
        <div className="text-sm text-neutral-500">{addressLine(t.address) || '—'}</div>
        {t.location_source === 'address' && t.lat == null && <div className="text-xs text-golddark">ไม่มีพิกัด: นำทางด้วยที่อยู่ โทรยืนยันก่อนไป</div>}
      </a>
      <ul className="text-sm list-disc pl-5">
        {t.items.map((i) => <li key={i}>{NEEDS.find((n) => n.id === i)?.label}</li>)}
        {t.other_need && <li>{t.other_need}</li>}
      </ul>
      {t.mental?.summary && (
        <div className="text-sm rounded-lg bg-neutral-100 p-2">
          <b>2Q 9Q 8Q:</b> {t.mental.summary}
          {t.mental.flags.length > 0 && <div className="text-lvred font-semibold">{t.mental.flags.join(' · ')}</div>}
        </div>
      )}
      {(t.line || t.email) && (
        <div className="text-sm flex flex-wrap gap-x-4">
          {t.line && <a className="text-golddark underline" href={`https://line.me/R/ti/p/~${encodeURIComponent(t.line)}`} target="_blank" rel="noreferrer">LINE: {t.line}</a>}
          {t.email && <a className="text-golddark underline" href={`mailto:${t.email}`}>{t.email}</a>}
        </div>
      )}
      <div className="text-xs text-neutral-500">
        {TICKET_STATUS[t.status]}{t.assignee_name ? ` · ${t.assignee_name}` : ''} · แจ้งเมื่อ {timeAgo(t.created_at)}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {canLocate(t) ? <a className="btn-gold text-sm px-2" href={navLink(t)} target="_blank" rel="noreferrer">🧭 นำทาง</a> : <span />}
        {t.phone ? <a className="btn-ghost text-sm px-2" href={`tel:${t.phone}`}>📞 โทร</a> : <span />}
        {t.status === 'open'
          ? <button disabled={busy} onClick={claim} className="btn-primary text-sm px-2">รับเรื่อง</button>
          : <button onClick={() => setOpen(!open)} className="btn-primary text-sm px-2">{mine ? 'อัปเดต' : 'บันทึก'}</button>}
      </div>
      {open && (
        <div className="space-y-2 pt-2 border-t">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(TICKET_STATUS).filter(([k]) => k !== 'open').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="บันทึกการให้ความช่วยเหลือ เช่น ตรวจแล้ว ตัดไฟจุดที่รั่ว แนะนำให้…" />
          <button disabled={busy} onClick={update} className="btn-primary w-full">บันทึก</button>
        </div>
      )}
    </div>
  );
}

export default function Tickets({ me, notify, onChange }) {
  const [rows, setRows] = useState(null);
  const [closed, setClosed] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [cat, setCat] = useState('');
  const [hideTaken, setHideTaken] = useState(() => localStorage.getItem('hideTaken') === '1');
  const toggleHideTaken = (v) => { setHideTaken(v); localStorage.setItem('hideTaken', v ? '1' : '0'); };

  const load = () => api(`api/tickets${closed ? '?status=closed' : ''}`).then((r) => {
    setRows(r);
    if (!closed) onChange?.(r.filter((t) => t.status === 'open').length);
  }).catch(() => setRows([]));
  useEffect(() => { load(); const t = setInterval(load, 45000); return () => clearInterval(t); }, [closed]);

  const cats = [...new Set((rows || []).map((t) => t.category))];
  const shown = (rows || []).filter((t) => (!onlyMine || t.assignee_id === me.id)
    && (!cat || t.category === cat)
    && (closed || !hideTaken || !t.assignee_id || t.assignee_id === me.id));

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold px-1">งานช่วยเหลือ</h1>
      <div className="flex gap-2 text-sm">
        <button onClick={() => setClosed(false)} className={`rounded-full px-3 py-1.5 ${!closed ? 'bg-ink text-white' : 'bg-white'}`}>เปิดอยู่</button>
        <button onClick={() => setClosed(true)} className={`rounded-full px-3 py-1.5 ${closed ? 'bg-ink text-white' : 'bg-white'}`}>ปิดแล้ว</button>
        <label className="ml-auto flex items-center gap-2"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />ของฉัน</label>
      </div>
      <div className="flex gap-2 text-sm items-center">
        {(cats.length > 1 || cat) && (
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="w-auto">
            <option value="">ทุกด้าน</option>
            {Object.entries(CATEGORIES).filter(([k]) => cats.includes(k) || k === cat).map(([k, c]) => <option key={k} value={k}>{c.icon} {c.label}</option>)}
          </select>
        )}
        {!closed && <label className="ml-auto flex items-center gap-2"><input type="checkbox" checked={hideTaken} onChange={(e) => toggleHideTaken(e.target.checked)} />ซ่อนงานที่คนอื่นรับแล้ว</label>}
      </div>
      {me.role === 'responder' && (
        me.specialties?.length
          ? <div className="text-sm text-neutral-500 px-1">ด้านของคุณ: {me.specialties.map((s) => SPECIALTIES[s]).join(' · ')}</div>
          : <div className="card bg-goldpale text-sm">ยังไม่ได้กำหนดด้านที่รับผิดชอบ จึงยังไม่เห็นงาน ติดต่อผู้ดูแลระบบ</div>
      )}
      {rows === null ? <Empty>กำลังโหลด…</Empty> : shown.length === 0 ? <Empty>ไม่มีงาน</Empty>
        : shown.map((t) => <TicketCard key={t.id} t={t} me={me} reload={load} notify={notify} />)}
    </div>
  );
}
