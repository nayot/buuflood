import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { MODULES, ROLE_LABEL } from '../../../shared/activities.js';
import { Empty, Field, Section, Check } from '../components/ui.jsx';

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thDate = (d) => { if (!d) return ''; const [y, m, day] = d.split('-').map(Number); return `${day} ${TH_MONTHS[m - 1]} ${y + 543}`; };
export const dates = (a) => (a.starts_on ? (a.ends_on && a.ends_on !== a.starts_on ? `${thDate(a.starts_on)} – ${thDate(a.ends_on)}` : thDate(a.starts_on)) : '');
const modulesLine = (mods = []) => mods.map((m) => `${MODULES[m]?.icon} ${MODULES[m]?.label}`).join(' · ');

// Pick the activity to work in. Admins also create activities here, archive them when the work is handed over, and
// reach archived ones for analysis.
export default function Activities({ me, activities, current, onPick, notify, refreshMe }) {
  const admin = me.realRole === 'admin';
  const [all, setAll] = useState(null);
  const [form, setForm] = useState(null);
  const load = () => (admin ? api('api/activities').then(setAll).catch(() => setAll([])) : null);
  useEffect(() => { load(); }, [admin]);

  const mine = activities.filter((a) => a.status === 'live' && a.role);
  const choose = (a) => { if (a.role === 'pending') return notify('รอผู้จัดการกิจกรรมอนุมัติ'); onPick(a.id); };

  const save = async () => {
    try {
      if (form.id) await api(`api/activities/${form.id}`, { method: 'PATCH', body: form });
      else await api('api/activities', { method: 'POST', body: form });
      notify(form.id ? 'บันทึกแล้ว' : 'สร้างกิจกรรมแล้ว'); setForm(null); load(); refreshMe();
    } catch (e) { notify(e.message === 'modules' ? 'เลือกอย่างน้อยหนึ่งส่วน' : e.message === 'name' ? 'ใส่ชื่อกิจกรรม' : e.message); }
  };
  const archive = async (a, archived) => {
    const msg = archived
      ? `เก็บถาวร “${a.name}”?\n\nข้อมูลจะเป็นแบบอ่านอย่างเดียว ลิงก์เข้าร่วมจะปิด อาสาสมัครจะไม่เห็นกิจกรรมนี้อีก (ผู้ดูแลระบบและผู้จัดการกิจกรรมยังเปิดดูและดาวน์โหลดข้อมูลได้)\n\nตรวจก่อนว่าไม่มีโทรศัพท์เครื่องใดยังแสดง “รอส่ง”`
      : `เปิด “${a.name}” ใช้งานอีกครั้ง?`;
    if (!confirm(msg)) return;
    try { await api(`api/activities/${a.id}/archive`, { method: 'POST', body: { archived } }); notify(archived ? 'เก็บถาวรแล้ว' : 'เปิดใช้งานแล้ว'); load(); refreshMe(); }
    catch (e) { notify(e.message); }
  };
  const deidentify = async (a) => {
    const typed = prompt(`ลบข้อมูลส่วนบุคคลออกจาก “${a.name}”\n\nชื่อ เบอร์โทร LINE อีเมล บ้านเลขที่ พิกัดบ้าน คำตอบแบบคัดกรอง บันทึกข้อความ และรูปทั้งหมดจะถูกลบถาวร เหลือเฉพาะสถิติ (ระดับ ความต้องการ หมู่/ตำบล/อำเภอ สถานะงาน)\nทำแล้วย้อนกลับไม่ได้ ควรดาวน์โหลดไฟล์ไว้ก่อนถ้ายังต้องใช้\n\nพิมพ์ชื่อกิจกรรมเพื่อยืนยัน:`);
    if (typed === null) return;
    if (typed.trim() !== a.name) return notify('ชื่อไม่ตรง ยังไม่ได้ลบ');
    try { await api(`api/activities/${a.id}/deidentify`, { method: 'POST', body: { confirm: a.name } }); notify('ลบข้อมูลส่วนบุคคลแล้ว'); load(); }
    catch (e) { notify(e.message); }
  };

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold px-1">กิจกรรม</h1>
      {mine.length ? mine.map((a) => (
        <button key={a.id} onClick={() => choose(a)}
          className={`card w-full text-left space-y-1 ${a.id === current ? 'border-2 border-golddark' : ''} ${a.role === 'pending' ? 'opacity-60' : ''}`}>
          <div className="font-bold">{a.name}</div>
          <div className="text-sm text-neutral-600">{[a.area, dates(a)].filter(Boolean).join(' · ')}</div>
          <div className="text-xs text-neutral-500">{modulesLine(a.modules)} · บทบาท: <b>{ROLE_LABEL[a.role]}</b></div>
        </button>
      )) : !admin && (
        <Empty>ยังไม่ได้เข้าร่วมกิจกรรมใด<br />สแกน QR หรือเปิดลิงก์เข้าร่วมจากผู้ประสานงานของกิจกรรม</Empty>
      )}

      {!admin && activities.some((a) => a.status === 'archived') && (
        <>
          <h2 className="font-bold text-lg px-1 pt-2">เก็บถาวรแล้ว</h2>
          {activities.filter((a) => a.status === 'archived').map((a) => (
            <button key={a.id} onClick={() => onPick(a.id, '/summary')} className="card w-full text-left space-y-1 bg-neutral-50">
              <div className="font-bold">📦 {a.name}</div>
              <div className="text-sm text-neutral-600">{[a.area, dates(a)].filter(Boolean).join(' · ')}</div>
              <div className="text-xs text-neutral-500">ดูอย่างเดียว · สรุปและดาวน์โหลดข้อมูล</div>
            </button>
          ))}
        </>
      )}

      {admin && (
        <>
          <div className="flex items-center gap-2 px-1 pt-2">
            <h2 className="font-bold text-lg flex-1">ทุกกิจกรรม (ผู้ดูแลระบบ)</h2>
            <button className="btn-primary" onClick={() => setForm({ name: '', area: '', starts_on: '', ends_on: '', modules: ['visits'] })}>➕ สร้างกิจกรรม</button>
          </div>
          {form && (
            <Section title={form.id ? 'แก้ไขกิจกรรม' : 'กิจกรรมใหม่'}>
              <Field label="ชื่อกิจกรรม"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น ศูนย์ซ่อม ต.โขมง 17–18 ต.ค." /></Field>
              <Field label="พื้นที่"><input value={form.area || ''} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="เช่น อ.แกลง จ.ระยอง" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="วันเริ่ม"><input type="date" value={form.starts_on || ''} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} /></Field>
                <Field label="วันสิ้นสุด"><input type="date" value={form.ends_on || ''} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} /></Field>
              </div>
              <div className="space-y-2">
                <span className="label">ส่วนที่ใช้ในกิจกรรมนี้</span>
                {Object.entries(MODULES).map(([k, m]) => (
                  <Check key={k} checked={form.modules.includes(k)}
                    onChange={(c) => setForm({ ...form, modules: c ? [...form.modules, k] : form.modules.filter((x) => x !== k) })}>
                    {m.icon} <b>{m.label}</b><br /><span className="text-xs text-neutral-500">{m.detail}</span>
                  </Check>
                ))}
              </div>
              <div className="flex gap-2">
                <button className="btn-primary flex-1" onClick={save}>บันทึก</button>
                <button className="btn-ghost flex-1" onClick={() => setForm(null)}>ยกเลิก</button>
              </div>
            </Section>
          )}
          {all === null ? <Empty>กำลังโหลด…</Empty> : all.map((a) => (
            <div key={a.id} className={`card space-y-2 ${a.status === 'archived' ? 'bg-neutral-50' : ''}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="font-bold">{a.status === 'archived' && '📦 '}{a.name}</div>
                  <div className="text-sm text-neutral-600">{[a.area, dates(a)].filter(Boolean).join(' · ')}</div>
                  <div className="text-xs text-neutral-500">
                    {modulesLine(a.modules)} · สมาชิก {a.members}{a.pending ? ` (รออนุมัติ ${a.pending})` : ''}
                    {a.visits != null && ` · เยี่ยมบ้าน ${a.visits}`}{a.repairs ? ` · รับซ่อม ${a.repairs}` : ''}
                  </div>
                  {a.managers && <div className="text-xs text-neutral-500">ผู้จัดการ: {a.managers}</div>}
                  {a.status === 'archived' && (
                    <div className="text-xs text-neutral-500">เก็บถาวรแล้ว{a.deidentified_at ? ' · ลบข้อมูลส่วนบุคคลแล้ว' : ' · ยังมีข้อมูลส่วนบุคคล'} · แฟ้มบนเซิร์ฟเวอร์ data/{a.folder}/</div>
                  )}
                </div>
                <button className="btn-primary shrink-0" onClick={() => onPick(a.id)}>เข้า</button>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <button className="text-golddark underline" onClick={() => onPick(a.id, '/summary')}>📊 สรุปและส่งออก</button>
                {a.status === 'live' && <button className="text-golddark underline" onClick={() => setForm({ ...a })}>✏️ แก้ไข</button>}
                {a.status === 'live'
                  ? <button className="text-golddark underline" onClick={() => archive(a, true)}>📦 เก็บถาวร</button>
                  : <button className="text-golddark underline" onClick={() => archive(a, false)}>↩️ เปิดใช้งานอีกครั้ง</button>}
                {a.status === 'archived' && !a.deidentified_at && <button className="text-lvred underline" onClick={() => deidentify(a)}>🧹 ลบข้อมูลส่วนบุคคล</button>}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
