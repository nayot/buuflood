import { useEffect, useState } from 'react';
import { api, timeAgo } from '../lib/api.js';
import { ROLE_LABEL } from '../../../shared/activities.js';
import { Empty } from '../components/ui.jsx';

const ACCOUNT_ROLES = { user: 'ผู้ใช้', admin: 'ผู้ดูแลระบบ (เห็นทุกกิจกรรม)', pending: 'รออนุมัติ (ยังใช้งานไม่ได้)' };

// Every Google account that has signed in (admins). Roles inside an activity are set on its members page.
export default function Users({ me, notify, refreshMe }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const load = () => api('api/users').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const setRole = async (u, role) => {
    try { await api(`api/users/${u.id}`, { method: 'PATCH', body: { role } }); notify('บันทึกแล้ว'); load(); refreshMe(); }
    catch { notify('บันทึกไม่สำเร็จ'); }
  };
  const remove = async (u) => {
    if (!confirm(`ลบบัญชี ${u.name} (${u.email})?\nจะออกจากทุกกิจกรรม ถ้าเข้าสู่ระบบอีกจะเป็นบัญชีใหม่ที่ยังไม่ได้อยู่ในกิจกรรมใด`)) return;
    try { await api(`api/users/${u.id}`, { method: 'DELETE' }); load(); refreshMe(); } catch { notify('ไม่สำเร็จ'); }
  };

  const shown = (rows || []).filter((u) => !q || `${u.name} ${u.email} ${u.phone || ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold px-1">บัญชีผู้ใช้</h1>
      <p className="text-sm text-neutral-500 px-1">ทุกบัญชีที่เคยเข้าสู่ระบบ บทบาทในแต่ละกิจกรรม (อาสาสมัคร ผู้เชี่ยวชาญ ผู้จัดการ ฯลฯ) กำหนดที่หน้าสมาชิกของกิจกรรมนั้น บัญชีภายนอก (เช่น @gmail.com) ที่ “รออนุมัติ” อนุมัติได้ที่นี่ หรือโดยผู้จัดการของกิจกรรมที่บัญชีนั้นขอเข้าร่วม</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ อีเมล หรือเบอร์โทร" />
      {rows === null ? <Empty>กำลังโหลด…</Empty> : shown.map((u) => (
        <div key={u.id} className={`card space-y-2 ${u.role === 'pending' ? 'border-2 border-lvred' : ''}`}>
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <div className="font-semibold">{u.name}</div>
              <div className="text-xs text-neutral-500">{u.email} · เข้าใช้ {timeAgo(u.last_login)}</div>
              <div className="text-xs">{u.phone ? <a className="text-golddark underline" href={`tel:${u.phone}`}>📞 {u.phone}</a> : <span className="text-neutral-400">ยังไม่มีเบอร์โทร</span>}</div>
              <div className="text-xs text-neutral-600 mt-1">
                {u.activities.length ? u.activities.map((a) => `${a.status === 'archived' ? '📦 ' : ''}${a.name} (${ROLE_LABEL[a.role] || a.role})`).join(' · ') : 'ยังไม่ได้อยู่ในกิจกรรมใด'}
              </div>
            </div>
            {u.id !== me.id && <button className="text-xs text-lvred underline" onClick={() => remove(u)}>ลบบัญชี</button>}
          </div>
          <select value={u.role} disabled={u.id === me.id} onChange={(e) => setRole(u, e.target.value)}>
            {Object.entries(ACCOUNT_ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}
