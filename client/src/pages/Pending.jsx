import { useState } from 'react';
import { api } from '../lib/api.js';
import PhonePrompt from '../components/PhonePrompt.jsx';
import Copyright from '../components/Copyright.jsx';

// Accounts from approval domains (e.g. @gmail.com) wait here until an admin, or the manager of an activity they asked
// to join, approves them.
export default function Pending({ me, activities = [], onRefresh }) {
  const [editPhone, setEditPhone] = useState(false);
  const logout = async () => { await api('auth/logout', { method: 'POST' }); window.location.reload(); };
  return (
    <div className="min-h-dvh grid place-items-center p-6 bg-ink">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center space-y-4 shadow-xl">
        <img src="buu-eng-logo.png" alt="มหาวิทยาลัยบูรพา คณะวิศวกรรมศาสตร์" className="h-12 mx-auto" />
        <h1 className="text-xl font-bold">รออนุมัติ</h1>
        <p className="text-sm text-neutral-600">บัญชี <b>{me.email}</b> ลงทะเบียนแล้ว แจ้งผู้ประสานงานของกิจกรรมให้อนุมัติ แล้วกด “ตรวจสอบอีกครั้ง”</p>
        {activities.length > 0 && <p className="text-sm">ขอเข้าร่วม: <b>{activities.map((a) => a.name).join(', ')}</b></p>}
        {!activities.length && <p className="text-xs text-neutral-500">ยังไม่ได้ขอเข้าร่วมกิจกรรมใด: สแกน QR หรือเปิดลิงก์เข้าร่วมจากผู้ประสานงาน</p>}
        <div className="rounded-xl bg-goldpale p-3 text-sm">
          📞 เบอร์โทรของคุณ: <b>{me.phone || 'ยังไม่ได้ใส่'}</b>
          <button onClick={() => setEditPhone(true)} className="block mx-auto mt-1 text-golddark underline">{me.phone ? 'แก้ไข' : 'ใส่เบอร์โทร (ช่วยให้อนุมัติได้เร็วขึ้น)'}</button>
        </div>
        <button onClick={onRefresh} className="btn-primary w-full">ตรวจสอบอีกครั้ง</button>
        <button onClick={logout} className="btn-ghost w-full">ออกจากระบบ</button>
        <Copyright className="pt-2" />
      </div>
      {editPhone && <PhonePrompt me={me} skipLabel="ยกเลิก" onSaved={onRefresh} onDone={() => setEditPhone(false)} />}
    </div>
  );
}
