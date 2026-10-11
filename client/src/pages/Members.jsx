import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { api, timeAgo } from '../lib/api.js';
import { SPECIALTIES, parseSpecialties } from '../../../shared/triage.js';
import { ACTIVITY_ROLES } from '../../../shared/activities.js';
import { Empty, Check, Section } from '../components/ui.jsx';

// The activity's join link and its members (managers and admins).
export default function Members({ me, activity, notify, refreshMe }) {
  const [rows, setRows] = useState(null);
  const [join, setJoin] = useState(null);
  const [q, setQ] = useState('');
  const load = () => api('api/admin/members').then(setRows).catch(() => setRows([]));
  const loadJoin = () => api('api/admin/join').then(setJoin).catch(() => setJoin(null));
  useEffect(() => { load(); loadJoin(); }, []);

  const link = join?.token ? `${window.location.origin}${window.location.pathname}#/join/${join.token}` : null;
  const qr = useMemo(() => {
    if (!link) return null;
    const c = qrcode(0, 'M'); c.addData(link); c.make();
    return c.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
  }, [link]);

  const setJoinState = async (body) => { try { await api('api/admin/join', { method: 'POST', body }); loadJoin(); } catch (e) { notify(e.message); } };
  const save = async (u, patch) => {
    const next = { role: u.role, specialty: u.specialty, ...patch };
    try { await api(`api/admin/members/${u.id}`, { method: 'PATCH', body: next }); notify('บันทึกแล้ว'); load(); refreshMe(); }
    catch { notify('บันทึกไม่สำเร็จ'); }
  };
  const remove = async (u) => {
    if (!confirm(`นำ ${u.name} ออกจากกิจกรรมนี้?`)) return;
    try { await api(`api/admin/members/${u.id}`, { method: 'DELETE' }); load(); } catch { notify('ไม่สำเร็จ'); }
  };
  const copy = () => navigator.clipboard?.writeText(link).then(() => notify('คัดลอกลิงก์แล้ว'), () => notify(link));

  const shown = (rows || []).filter((u) => !q || `${u.name} ${u.email} ${u.phone || ''}`.toLowerCase().includes(q.toLowerCase()));
  const archived = activity.status === 'archived';

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold px-1">สมาชิก · {activity.name}</h1>
      {!archived && (
        <Section title="ลิงก์เข้าร่วม" hint="ให้อาสาสมัครสแกน QR นี้ (หรือส่งลิงก์ให้) แล้วเข้าสู่ระบบด้วยบัญชี Google จะเข้าร่วมเป็นอาสาสมัครทันที บัญชีภายนอก (เช่น @gmail.com) ต้องรออนุมัติที่หน้านี้">
          {join === null ? <Empty>กำลังโหลด…</Empty> : (
            <>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={join.open} onChange={(e) => setJoinState({ open: e.target.checked })} />
                <span>เปิดรับสมาชิกใหม่ทางลิงก์นี้</span>
              </label>
              {join.open && link && (
                <>
                  <div className="mx-auto w-56 bg-white" dangerouslySetInnerHTML={{ __html: qr }} />
                  <div className="text-xs break-all text-neutral-500 text-center">{link}</div>
                  <div className="flex gap-2">
                    <button className="btn-ghost flex-1" onClick={copy}>📋 คัดลอกลิงก์</button>
                    <button className="btn-ghost flex-1" onClick={() => confirm('สร้างลิงก์ใหม่? ลิงก์และ QR เดิมจะใช้ไม่ได้อีก') && setJoinState({ regenerate: true })}>🔄 ลิงก์ใหม่</button>
                  </div>
                </>
              )}
            </>
          )}
        </Section>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ อีเมล หรือเบอร์โทร" />
      {rows === null ? <Empty>กำลังโหลด…</Empty> : !shown.length ? <Empty>ยังไม่มีสมาชิก</Empty> : shown.map((u) => (
        <div key={u.id} className={`card space-y-2 ${u.role === 'pending' ? 'border-2 border-lvred' : ''}`}>
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <div className="font-semibold">{u.name}{u.account === 'admin' && <span className="text-xs text-neutral-500"> · ผู้ดูแลระบบ</span>}</div>
              <div className="text-xs text-neutral-500">{u.email} · เข้าใช้ {timeAgo(u.last_login)}</div>
              <div className="text-xs">{u.phone ? <a className="text-golddark underline" href={`tel:${u.phone}`}>📞 {u.phone}</a> : <span className="text-neutral-400">ยังไม่มีเบอร์โทร</span>}</div>
            </div>
            {u.id !== me.id && <button className="text-xs text-lvred underline" onClick={() => remove(u)}>นำออก</button>}
          </div>
          {u.role === 'pending' && <p className="text-xs text-lvred">บัญชีภายนอกขอเข้าร่วม: ตรวจว่าเป็นใคร (โทรตามเบอร์ที่ให้ไว้) แล้วเลือกบทบาทเพื่ออนุมัติ</p>}
          <select value={u.role} disabled={u.id === me.id && me.realRole !== 'admin'} onChange={(e) => save(u, { role: e.target.value })}>
            {Object.entries(ACTIVITY_ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {u.role === 'responder' && (
            <div className="space-y-1">
              <span className="label">ด้านที่รับผิดชอบ (เลือกได้หลายด้าน)</span>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(SPECIALTIES).map(([k, l]) => {
                  const mine = parseSpecialties(u.specialty);
                  return (
                    <Check key={k} checked={mine.includes(k)}
                      onChange={(c) => save(u, { specialty: (c ? [...mine, k] : mine.filter((x) => x !== k)).join(',') })}>{l}</Check>
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
