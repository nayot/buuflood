import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import { cleanPhone } from '../../../shared/contact.js';

// Asks the volunteer for their own phone so the team and responders can reach them. Skipping is allowed
// (for example without a signal); the app asks again at the next visit while no number is saved.
// Rendered into <body>: it has its own <form>, and the visit form must not contain it.
export default function PhonePrompt({ me, onDone, onSaved, skipLabel = 'ไว้ทีหลัง' }) {
  const [phone, setPhone] = useState(me.phone || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    if (cleanPhone(phone).replace(/\D/g, '').length < 9) return setErr('เบอร์โทรศัพท์ไม่ครบ');
    setBusy(true);
    try { await api('api/me/phone', { method: 'POST', body: { phone } }); await onSaved?.(); onDone(true); }
    catch { setErr('บันทึกเบอร์ไม่สำเร็จ (ไม่มีสัญญาณ?) ลองใหม่ภายหลังได้'); }
    setBusy(false);
  };
  return createPortal(
    <div className="fixed inset-0 z-[1200] bg-black/50 grid place-items-center p-4">
      <form onSubmit={save} className="w-full max-w-sm rounded-2xl bg-white p-5 space-y-3 shadow-xl">
        <h2 className="font-bold text-lg">📞 เบอร์โทรของคุณ</h2>
        <p className="text-sm text-neutral-500">เพื่อให้ทีมประสานงานและผู้เชี่ยวชาญติดต่อคุณได้เมื่อต้องการข้อมูลเพิ่มเกี่ยวกับบ้านที่คุณบันทึก</p>
        <input type="tel" inputMode="tel" autoFocus value={phone} onChange={(e) => { setPhone(e.target.value); setErr(null); }} placeholder="08x-xxx-xxxx" />
        {err && <p className="text-sm text-lvred">{err}</p>}
        <button disabled={busy} className="btn-primary w-full">บันทึกเบอร์</button>
        <button type="button" onClick={() => onDone(false)} className="btn-ghost w-full">{skipLabel}</button>
      </form>
    </div>,
    document.body,
  );
}
