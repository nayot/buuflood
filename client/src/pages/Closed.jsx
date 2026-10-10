import { api, timeAgo } from '../lib/api.js';
import Copyright from '../components/Copyright.jsx';

// Shown to everyone but admins while an admin has switched the app off. Queued visits stay on the phone
// (the server answers 503, which the outbox retries) and are sent once the app is open again.
export default function Closed({ me, closed, outbox, onRefresh }) {
  const logout = async () => { await api('auth/logout', { method: 'POST' }); window.location.reload(); };
  return (
    <div className="min-h-dvh grid place-items-center p-6 bg-ink">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center space-y-4 shadow-xl">
        <img src="buu-eng-logo.png" alt="มหาวิทยาลัยบูรพา คณะวิศวกรรมศาสตร์" className="h-12 mx-auto" />
        <h1 className="text-xl font-bold">ระบบปิดชั่วคราว</h1>
        {closed.message && <p className="rounded-xl bg-goldpale p-3">{closed.message}</p>}
        <p className="text-sm text-neutral-500">ปิดเมื่อ {timeAgo(closed.since)} โดยผู้ดูแลระบบ</p>
        {outbox > 0 && (
          <p className="text-sm rounded-xl bg-neutral-100 p-3">มีบันทึกรอส่ง <b>{outbox}</b> รายการ เก็บไว้ในเครื่องแล้ว จะส่งเองเมื่อเปิดระบบ <b>อย่าลบแอปหรือล้างข้อมูลเบราว์เซอร์</b></p>
        )}
        <button onClick={onRefresh} className="btn-primary w-full">ตรวจสอบอีกครั้ง</button>
        <button onClick={logout} className="btn-ghost w-full">ออกจากระบบ ({me.email})</button>
        <Copyright className="pt-2" />
      </div>
    </div>
  );
}
