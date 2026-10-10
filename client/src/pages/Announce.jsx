import { useEffect, useState } from 'react';
import { api, timeAgo } from '../lib/api.js';
import { Empty } from '../components/ui.jsx';

// Admins send an announcement; it pops up on every signed-in phone until acknowledged.
export default function Announce({ notify }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState(null);
  const load = () => api('api/announcements').then(setD).catch(() => setD({ users: 0, list: [] }));
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  const send = async () => {
    if (!msg.trim() || !confirm('ส่งประกาศนี้ให้ทุกคนตอนนี้?')) return;
    setBusy(true);
    try { await api('api/announcements', { method: 'POST', body: { message: msg } }); setMsg(''); notify('ส่งประกาศแล้ว'); load(); }
    catch (e) { notify(e.message); }
    setBusy(false);
  };
  const end = async (id) => {
    if (!confirm('ยกเลิกประกาศนี้? คนที่ยังไม่ได้กดรับทราบจะไม่เห็นอีก')) return;
    try { await api(`api/announcements/${id}/end`, { method: 'POST' }); load(); } catch (e) { notify(e.message); }
  };

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold px-1">📢 ประกาศ</h1>
      <div className="card space-y-2">
        <textarea rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={1000} placeholder="เช่น รวมพลที่ อบต.โขมง 15:00 น." />
        <button disabled={busy || !msg.trim()} onClick={send} className="btn-primary w-full">ส่งประกาศ</button>
      </div>
      {d === null ? <Empty>กำลังโหลด…</Empty> : d.list.length === 0 ? <Empty>ยังไม่มีประกาศ</Empty> : d.list.map((a) => (
        <div key={a.id} className={`card space-y-1 ${a.ended_at ? 'opacity-60' : ''}`}>
          <p className="whitespace-pre-wrap">{a.message}</p>
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span className="flex-1">{a.by} · {timeAgo(a.created_at)} · รับทราบแล้ว {a.acks}/{d.users} คน{a.ended_at ? ' · ยกเลิกแล้ว' : ''}</span>
            {!a.ended_at && <button onClick={() => end(a.id)} className="text-lvred underline">ยกเลิก</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
