import { useEffect, useState } from 'react';
import { api, addressLine, navLink, placeLink, canLocate, timeAgo } from '../lib/api.js';
import { NEEDS, CATEGORIES, TICKET_STATUS } from '../../../shared/triage.js';
import { Q2, Q9, Q9_SCALE, Q8, Q8_CONTROL, MENTAL_ADVICE } from '../../../shared/mental.js';
import { REFERRAL_STATUS } from '../../../shared/line.js';
import { REPAIR_STATUS } from '../../../shared/repairs.js';
import { LevelBadge, Empty, Section } from '../components/ui.jsx';
import EmergencyPanel from '../components/Emergency.jsx';

const Row = ({ k, children }) => (children ? <div className="flex gap-3 text-sm"><span className="w-28 shrink-0 text-neutral-500">{k}</span><span className="flex-1">{children}</span></div> : null);

// The answers given, for the people allowed to see them (the server leaves them out for everyone else).
function MentalAnswers({ m }) {
  const yn = (x) => (x ? 'มี' : 'ไม่มี');
  return (
    <details className="text-sm">
      <summary className="text-golddark cursor-pointer">ดูคำตอบรายข้อ</summary>
      <ol className="mt-2 space-y-1 list-decimal pl-5">
        {Q2.map((q, i) => <li key={q}>{q}: <b>{yn(m.q2?.[i])}</b></li>)}
      </ol>
      {m.q9?.some((x) => x != null) && (
        <ol className="mt-2 space-y-1 list-decimal pl-5">
          {Q9.map((q, i) => <li key={q}>{q}: <b>{Q9_SCALE[m.q9[i]] ?? '—'}</b></li>)}
        </ol>
      )}
      {m.q8?.some((x) => x != null) && (
        <ol className="mt-2 space-y-1 list-decimal pl-5">
          {Q8.map((q, i) => (
            <li key={q.text}>{q.text}: <b>{yn(m.q8[i])}</b>
              {i === 2 && m.q8[2] && <div>{Q8_CONTROL}: <b>{m.q8_control ? 'ได้' : 'ไม่ได้'}</b></div>}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

export default function VisitDetail({ id }) {
  const [v, setV] = useState(null);

  useEffect(() => { api(`api/visits/${id}`).then(setV).catch(() => setV(false)); }, [id]);

  if (v === null) return <Empty>กำลังโหลด…</Empty>;
  if (v === false) return <Empty>ไม่พบข้อมูล หรือไม่มีสิทธิ์เข้าถึง</Empty>;

  const a = v.address || {};
  const needs = (v.answers.needs || []).map((n) => NEEDS.find((x) => x.id === n)).filter(Boolean);

  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">{`${v.first_name || ''} ${v.last_name || ''}`.trim() || 'ไม่ระบุชื่อ'}</h1>
            <div className="text-sm text-neutral-500">บันทึกโดย {v.creator?.name} · {timeAgo(v.created_at)}</div>
          </div>
          <LevelBadge level={v.level} big />
        </div>
        {v.override_level && <div className="text-sm rounded-lg bg-goldpale p-2">ปรับระดับเป็น “{v.override_level}” เพราะ: {v.override_reason}</div>}
        <Row k="ที่อยู่">{addressLine(a)}</Row>
        <Row k="โทรศัพท์">{v.phone && <a className="text-golddark underline" href={`tel:${v.phone}`}>{v.phone}</a>}</Row>
        <Row k="LINE">{v.line && <a className="text-golddark underline" href={`https://line.me/R/ti/p/~${encodeURIComponent(v.line)}`} target="_blank" rel="noreferrer">{v.line}</a>}</Row>
        <Row k="อีเมล">{v.email && <a className="text-golddark underline" href={`mailto:${v.email}`}>{v.email}</a>}</Row>
        <Row k="ติดต่อ">{v.no_contact && 'ไม่มีช่องทางติดต่อ (ดูหมายเหตุ)'}</Row>
        {v.location_source === 'address' && (
          <div className="text-sm rounded-lg bg-goldpale p-2">
            พบผู้ประสบภัยนอกบ้าน: ตำแหน่งบ้าน{v.lat != null ? 'จากหมุดที่ปักบนแผนที่' : 'ค้นหาจากที่อยู่ (ไม่มีพิกัด GPS)'}
          </div>
        )}
        {canLocate(v) && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <a className="btn-gold" href={navLink(v)} target="_blank" rel="noreferrer">🧭 นำทาง</a>
            <a className="btn-ghost" href={placeLink(v)} target="_blank" rel="noreferrer">📍 Google Maps</a>
          </div>
        )}
      </div>

      <Section title="ความต้องการ">
        {needs.length === 0 && !v.answers.other_need ? <p className="text-sm text-neutral-500">—</p> : (
          <ul className="space-y-1 text-sm">
            {needs.map((n) => <li key={n.id}>{CATEGORIES[n.cat].icon} {n.label}</li>)}
            {v.answers.other_need && <li>📌 {v.answers.other_need}</li>}
            {v.answers.cannot_travel && <li className="font-semibold">🚫 เดินทางมาจุดบริการเองไม่ได้</li>}
          </ul>
        )}
        {v.notes && <p className="text-sm rounded-lg bg-neutral-100 p-2">{v.notes}</p>}
      </Section>

      {v.triage?.mental && (() => {
        const lvl = v.triage.categories?.mental?.level || v.triage.mental.level;
        return (
        <Section title="💛 ผลคัดกรองสุขภาพใจ (2Q 9Q 8Q)">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">
              {v.triage.mental.summary
                || [v.triage.mental.q9 != null && `9Q = ${v.triage.mental.q9}`, v.triage.mental.q8 != null && `8Q = ${v.triage.mental.q8}`].filter(Boolean).join(' · ')
                || '2Q ปกติ'}
            </span>
            <LevelBadge level={lvl} />
          </div>
          {v.triage.mental.flags?.length > 0 && <div className="text-sm text-lvred font-semibold">{v.triage.mental.flags.join(' · ')}</div>}
          {lvl === 'red'
            ? <EmergencyPanel advice={MENTAL_ADVICE.red} />
            : lvl && <p className="text-sm text-neutral-600">{MENTAL_ADVICE[lvl]}</p>}
          {v.line_referral && (
            <div className={`text-sm rounded-lg p-2 ${v.line_referral.status === 'sent' ? 'bg-green-50' : v.line_referral.status === 'failed' ? 'bg-red-50' : 'bg-goldpale'}`}>
              💬 ส่งต่อ BUU Flood Help (LINE) รหัส <b>{v.line_referral.code}</b>: {REFERRAL_STATUS[v.line_referral.status] || v.line_referral.status}
              {v.line_referral.status === 'failed' && <div className="text-xs text-neutral-500">ผู้ประสบภัยอาจยังไม่ได้เพิ่มเพื่อน ให้ทีมสุขภาพใจติดต่อทางโทรศัพท์แทน</div>}
            </div>
          )}
          {v.answers.mental && <MentalAnswers m={v.answers.mental} />}
        </Section>
        );
      })()}

      {v.repair_needs?.length > 0 && (
        <Section title={`🔧 สิ่งของที่ต้องซ่อม (${v.repair_needs.length})`} hint="สำรวจความต้องการ ยังไม่มีเลขคิว เจ้าของต้องนำสิ่งของไปลงทะเบียนรับคิวที่ศูนย์ซ่อมด้วยตนเอง">
          {v.repair_needs.map((n) => (
            <div key={n.uuid} className="rounded-xl border border-neutral-200 p-2 space-y-2">
              <div className="text-sm">
                <b>{n.type_label}{n.type_other ? ` (${n.type_other})` : ''}</b>{n.brand ? ` · ${n.brand}` : ''}
                {n.problem && <div className="text-neutral-600">{n.problem}</div>}
              </div>
              {n.photos.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {n.photos.map((p) => (
                    <a key={p} href={`api/photos/${p}`} target="_blank" rel="noreferrer">
                      <img src={`api/photos/${p}`} alt="" loading="lazy" className="aspect-square w-full object-cover rounded-lg" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      {v.repairs?.length > 0 && (
        <Section title={`🔧 ลงทะเบียนศูนย์ซ่อม (${v.repairs.length})`} hint="บันทึกจากรุ่นก่อน 2.3 ที่ออกเลขคิวจากการเยี่ยมบ้าน">
          {v.repairs.map((r) => (
            <a key={r.id} href={`#/repair/${r.id}`} className="flex items-center gap-3 rounded-xl border border-neutral-200 p-2">
              {r.photos[0] && <img src={`api/repair-photos/${r.photos[0]}`} alt="" className="w-14 h-14 object-cover rounded-lg" />}
              <div className="flex-1 min-w-0">
                <div className="font-bold text-lg">{r.queue}</div>
                <div className="text-sm truncate">{r.type_label}{r.type_other ? ` (${r.type_other})` : ''}{r.brand ? ` · ${r.brand}` : ''}</div>
              </div>
              <span className="text-xs text-neutral-500 text-right">{REPAIR_STATUS[r.status]}</span>
            </a>
          ))}
        </Section>
      )}

      {v.tickets.length > 0 && (
        <Section title="งานที่แจ้งทีม">
          {v.tickets.map((t) => (
            <div key={t.id} className="flex items-center justify-between text-sm">
              <span>{CATEGORIES[t.category]?.icon} {CATEGORIES[t.category]?.label} <LevelBadge level={t.level} /></span>
              <span className="text-neutral-500">{TICKET_STATUS[t.status]}{t.assignee_name ? ` · ${t.assignee_name}` : ''}</span>
            </div>
          ))}
        </Section>
      )}

      {v.photos.length > 0 && (
        <Section title={`รูปถ่าย (${v.photos.length})`}>
          <div className="grid grid-cols-3 gap-2">
            {v.photos.map((p) => (
              <a key={p} href={`api/photos/${p}`} target="_blank" rel="noreferrer">
                <img src={`api/photos/${p}`} alt="" loading="lazy" className="aspect-square w-full object-cover rounded-lg" />
              </a>
            ))}
          </div>
        </Section>
      )}

    </div>
  );
}
