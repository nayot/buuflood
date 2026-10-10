import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, timeAgo } from '../lib/api.js';

// Announcements from an admin pop up until the user presses รับทราบ. The phone checks every minute and whenever the
// app comes back on screen. An acknowledgement made offline is remembered here and sent again at the next check.
const KEY = 'acked';
const readAcked = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const writeAcked = (ids) => { try { localStorage.setItem(KEY, JSON.stringify(ids.slice(-50))); } catch { /* private mode */ } };

export function useAnnouncements(me) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!me) return undefined;
    const check = async () => {
      try {
        const rows = await api('api/announcements/pending');
        const acked = readAcked();
        for (const a of rows.filter((r) => acked.includes(r.id))) api(`api/announcements/${a.id}/ack`, { method: 'POST' }).catch(() => {});
        setList(rows.filter((r) => !acked.includes(r.id)));
      } catch { /* offline: keep what is shown */ }
    };
    check();
    const t = setInterval(check, 60000);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [me?.id]);
  const ack = (id) => {
    writeAcked([...readAcked(), id]);
    setList((l) => l.filter((a) => a.id !== id));
    api(`api/announcements/${id}/ack`, { method: 'POST' }).catch(() => {});
  };
  return { current: list[0] || null, left: list.length, ack };
}

export function AnnouncementPopup({ a, left, onAck }) {
  if (!a) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1300] bg-black/60 grid place-items-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 space-y-3 shadow-xl border-t-8 border-gold">
        <h2 className="font-bold text-lg">📢 ประกาศ{left > 1 ? ` (1/${left})` : ''}</h2>
        <p className="whitespace-pre-wrap text-base">{a.message}</p>
        <p className="text-xs text-neutral-500">{a.by || 'ผู้ดูแลระบบ'} · {timeAgo(a.created_at)}</p>
        <button onClick={() => onAck(a.id)} className="btn-primary w-full">รับทราบ</button>
      </div>
    </div>,
    document.body,
  );
}
