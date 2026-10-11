import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { ROLE_LABEL } from '../../../shared/activities.js';
import { Empty } from '../components/ui.jsx';
import { dates } from './Activities.jsx';

// Opened from an activity's join link or QR code (#/join/<token>).
export default function Join({ token, onJoined, notify }) {
  const [a, setA] = useState(undefined);
  useEffect(() => { api(`api/join/${token}`).then(setA).catch(() => setA(null)); }, [token]);
  const join = async () => {
    try { const r = await api(`api/join/${token}`, { method: 'POST' }); notify('เข้าร่วมกิจกรรมแล้ว'); onJoined(r.id); }
    catch { notify('เข้าร่วมไม่สำเร็จ'); }
  };
  if (a === undefined) return <Empty>กำลังโหลด…</Empty>;
  if (!a) return <Empty>ลิงก์เข้าร่วมนี้ปิดแล้วหรือไม่ถูกต้อง<br />ขอลิงก์ใหม่จากผู้ประสานงานของกิจกรรม</Empty>;
  return (
    <div className="card space-y-3 text-center">
      <div className="text-sm text-neutral-500">เข้าร่วมกิจกรรม</div>
      <h1 className="text-xl font-bold">{a.name}</h1>
      <div className="text-sm text-neutral-600">{[a.area, dates(a)].filter(Boolean).join(' · ')}</div>
      {a.role
        ? <><p>คุณเป็นสมาชิกแล้ว ({ROLE_LABEL[a.role]})</p><button className="btn-primary w-full" onClick={() => onJoined(a.id)}>ไปที่กิจกรรม</button></>
        : <button className="btn-primary w-full" onClick={join}>เข้าร่วม</button>}
      <p className="text-xs text-neutral-500">เข้าร่วมเป็นอาสาสมัคร ผู้จัดการกิจกรรมจะกำหนดบทบาทอื่นให้ภายหลังถ้าจำเป็น</p>
    </div>
  );
}
