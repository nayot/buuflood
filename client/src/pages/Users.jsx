import { useEffect, useState } from 'react';
import { api, timeAgo } from '../lib/api.js';
import { SPECIALTIES, parseSpecialties } from '../../../shared/triage.js';
import { Empty, Check } from '../components/ui.jsx';

const ROLES = { volunteer: 'อาสาสมัคร', responder: 'ผู้เชี่ยวชาญ', office: 'เจ้าหน้าที่ (อบต./ศูนย์ช่วยเหลือ)', admin: 'ผู้ดูแลระบบ' };

export default function Users({ me, notify }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const load = () => api('api/users').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const save = async (u, patch) => {
    const next = { role: u.role, specialty: u.specialty, ...patch };
    try { await api(`api/users/${u.id}`, { method: 'PATCH', body: next }); notify('บันทึกแล้ว'); load(); }
    catch { notify('บันทึกไม่สำเร็จ'); }
  };

  const shown = (rows || []).filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold px-1">ผู้ใช้และสิทธิ์</h1>
      <p className="text-sm text-neutral-500 px-1">ผู้ใช้ใหม่เป็นอาสาสมัครโดยอัตโนมัติเมื่อเข้าสู่ระบบครั้งแรก กำหนดผู้เชี่ยวชาญพร้อมด้านที่รับผิดชอบได้ที่นี่</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อหรืออีเมล" />
      {rows === null ? <Empty>กำลังโหลด…</Empty> : shown.map((u) => (
        <div key={u.id} className="card space-y-2">
          <div>
            <div className="font-semibold">{u.name}</div>
            <div className="text-xs text-neutral-500">{u.email} · เข้าใช้ {timeAgo(u.last_login)}</div>
          </div>
          <div>
            <select value={u.role} disabled={u.id === me.id} onChange={(e) => save(u, { role: e.target.value })}>
              {Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          {u.role === 'responder' && (
            <div className="space-y-1">
              <span className="label">ด้านที่รับผิดชอบ (เลือกได้หลายด้าน)</span>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(SPECIALTIES).map(([k, l]) => {
                  const mine = parseSpecialties(u.specialty);
                  const on = mine.includes(k);
                  return (
                    <Check key={k} checked={on}
                      onChange={(c) => save(u, { specialty: (c ? [...mine, k] : mine.filter((x) => x !== k)).join(',') })}>
                      {l}
                    </Check>
                  );
                })}
              </div>
              {parseSpecialties(u.specialty).length === 0 && <p className="text-xs text-lvred">ยังไม่ได้เลือกด้าน: จะยังไม่เห็นงานใด ๆ</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
