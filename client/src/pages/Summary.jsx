import { useEffect, useState } from 'react';
import { api, aurl } from '../lib/api.js';
import { REPAIR_STATUS } from '../../../shared/repairs.js';
import { TICKET_STATUS } from '../../../shared/triage.js';
import { Empty, Section } from '../components/ui.jsx';

const LEVEL = { red: ['แดง', 'bg-lvred text-white'], yellow: ['เหลือง', 'bg-lvyellow text-ink'], green: ['เขียว', 'bg-lvgreen text-white'] };
const fmt = (t) => (t ? new Date(`${t.replace(' ', 'T')}Z`).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

function Bars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.key} className="text-sm">
          <div className="flex gap-2"><span className="flex-1">{r.label}</span><b>{r.n}</b></div>
          <div className="h-1.5 rounded bg-neutral-100"><div className="h-1.5 rounded bg-gold" style={{ width: `${(r.n / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

// Statistics of one activity (live or archived) and the downloads for analysis (managers and admins).
export default function Summary({ me, activity }) {
  const [s, setS] = useState(null);
  useEffect(() => { api('api/admin/summary').then(setS).catch(() => setS(false)); }, [activity.id]);
  const visits = activity.modules.includes('visits');
  const repairs = activity.modules.includes('repairs');
  const dl = (what, q = '') => aurl(`api/admin/export/${what}${q}`);

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold px-1">สรุป · {activity.name}</h1>
      {s === null ? <Empty>กำลังโหลด…</Empty> : s === false ? <Empty>โหลดไม่สำเร็จ</Empty> : (
        <>
          {visits && (
            <Section title={`เยี่ยมบ้าน ${s.visits} หลัง`} hint={s.visits ? `อาสาสมัคร ${s.volunteers} คน · ${fmt(s.first)} ถึง ${fmt(s.last)}` : null}>
              <div className="grid grid-cols-3 gap-2 text-center">
                {Object.entries(LEVEL).map(([k, [l, c]]) => (
                  <div key={k} className={`rounded-xl py-2 ${c}`}><div className="text-2xl font-bold">{s.levels[k] || 0}</div><div className="text-xs">{l}</div></div>
                ))}
              </div>
              {Object.keys(s.by_day).length > 1 && <Bars rows={Object.entries(s.by_day).sort().map(([d, n]) => ({ key: d, label: d, n }))} />}
              <div className="text-xs text-neutral-500">ตำแหน่งจาก GPS {s.location.gps || 0} · จากที่อยู่ {s.location.address || 0}
                {Object.keys(s.mental).length > 0 && ` · คัดกรองสุขภาพใจ ${Object.values(s.mental).reduce((a, b) => a + b, 0)} คน (แดง ${s.mental.red || 0} เหลือง ${s.mental.yellow || 0} เขียว ${s.mental.green || 0})`}</div>
            </Section>
          )}
          {visits && s.needs.length > 0 && <Section title="ความต้องการ"><Bars rows={s.needs.map((n) => ({ key: n.id, label: n.label, n: n.n }))} /></Section>}
          {visits && s.tickets.length > 0 && (
            <Section title="งานของผู้เชี่ยวชาญ" hint={Object.entries(s.ticket_status).map(([k, n]) => `${TICKET_STATUS[k] || k} ${n}`).join(' · ')}>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-neutral-500"><th>หมวด</th><th className="text-right">ทั้งหมด</th><th className="text-right">แดง</th><th className="text-right">ยังเปิด</th></tr></thead>
                <tbody>{s.tickets.map((t) => <tr key={t.category}><td>{t.label}</td><td className="text-right">{t.n}</td><td className="text-right">{t.red}</td><td className="text-right font-bold">{t.open}</td></tr>)}</tbody>
              </table>
            </Section>
          )}
          {visits && s.areas.length > 0 && <Section title="พื้นที่"><Bars rows={s.areas.map((a) => ({ key: a.area, label: a.area, n: a.n }))} /></Section>}
          {visits && s.repair_needs.length > 0 && <Section title="ของที่ต้องซ่อม (สำรวจจากการเยี่ยมบ้าน)"><Bars rows={s.repair_needs.map((r) => ({ key: r.type, label: r.label, n: r.n }))} /></Section>}
          {(repairs || s.repairs.total > 0) && (
            <Section title={`ศูนย์ซ่อม ${s.repairs.total} ชิ้น`} hint={Object.entries(s.repairs.by_status).map(([k, n]) => `${REPAIR_STATUS[k] || k} ${n}`).join(' · ')}>
              <Bars rows={s.repairs.by_type.map((r) => ({ key: r.type, label: r.label, n: r.n }))} />
            </Section>
          )}
        </>
      )}
      <Section title="ดาวน์โหลดข้อมูลสำหรับวิเคราะห์" hint="ไฟล์ CSV เปิดด้วย Excel ได้ ไฟล์ “ไม่มีข้อมูลส่วนบุคคล” ไม่มีชื่อ เบอร์ติดต่อ บ้านเลขที่ พิกัด บันทึก และคะแนน 9Q/8Q ส่วนไฟล์ SQLite คือฐานข้อมูลทั้งชุดของกิจกรรม (เบอร์ติดต่อเข้ารหัสอยู่)">
        <div className="grid grid-cols-2 gap-2 text-sm">
          {visits && <><a className="btn-ghost" href={dl('visits.csv')}>⬇️ บันทึกเยี่ยมบ้าน</a><a className="btn-ghost" href={dl('visits.csv', '?pii=1')}>⬇️ บันทึกเยี่ยมบ้าน + ข้อมูลส่วนบุคคล</a>
            <a className="btn-ghost" href={dl('tickets.csv')}>⬇️ งาน</a><a className="btn-ghost" href={dl('tickets.csv', '?pii=1')}>⬇️ งาน + ข้อมูลส่วนบุคคล</a></>}
          {(repairs || s?.repairs?.total > 0) && <><a className="btn-ghost" href={dl('repairs.csv')}>⬇️ ศูนย์ซ่อม</a><a className="btn-ghost" href={dl('repairs.csv', '?pii=1')}>⬇️ ศูนย์ซ่อม + ข้อมูลส่วนบุคคล</a></>}
          <a className="btn-ghost" href={dl('volunteers.csv')}>⬇️ อาสาสมัครและทีม</a><a className="btn-ghost" href={dl('volunteers.csv', '?pii=1')}>⬇️ อาสาสมัครและทีม + เบอร์โทร</a>
          <a className="btn-ghost" href={dl('snapshot.db')}>🗄️ ฐานข้อมูล SQLite</a>
          {me.realRole === 'admin' && <a className="btn-ghost" href={dl('snapshot.db', '?decrypt=1')}>🗄️ SQLite + ถอดรหัสเบอร์ติดต่อ</a>}
        </div>
        <p className="text-xs text-lvred">ไฟล์ที่มีข้อมูลส่วนบุคคล: เก็บในเครื่องที่ปลอดภัย ใช้เฉพาะในทีมโครงการ และลบเมื่อติดตามเสร็จ (PDPA)</p>
      </Section>
    </div>
  );
}
