import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, addressLine, navLink, placeLink, canLocate, timeAgo } from '../lib/api.js';
import { NEEDS, CATEGORIES, TICKET_STATUS, RELIEF_CASES, RESIDENCE_TYPES, EVIDENCE } from '../../../shared/triage.js';
import { LevelBadge, Empty, Section } from '../components/ui.jsx';

const Row = ({ k, children }) => (children ? <div className="flex gap-3 text-sm"><span className="w-28 shrink-0 text-neutral-500">{k}</span><span className="flex-1">{children}</span></div> : null);

export default function VisitDetail({ id, notify }) {
  const [v, setV] = useState(null);
  const [link, setLink] = useState(null);
  const [qr, setQr] = useState(null);

  useEffect(() => { api(`api/visits/${id}`).then(setV).catch(() => setV(false)); }, [id]);

  const makeLink = async () => {
    try {
      const r = await api(`api/visits/${id}/print-link`, { method: 'POST' });
      setLink(r);
      setQr(await QRCode.toDataURL(r.url, { margin: 1, width: 240 }));
    } catch (e) { notify(e.body?.error === 'no consent' ? 'ไม่มีความยินยอมเก็บข้อมูล จึงพิมพ์แบบคำร้องไม่ได้' : 'สร้างลิงก์ไม่สำเร็จ'); }
  };
  const share = async () => {
    const text = `แบบคำร้องขอรับความช่วยเหลือผู้ประสบอุทกภัย (กรอกล่วงหน้า) — ${v.first_name || ''} ${v.last_name || ''}`;
    if (navigator.share) navigator.share({ title: 'แบบคำร้อง', text, url: link.url }).catch(() => {});
    else { await navigator.clipboard.writeText(link.url); notify('คัดลอกลิงก์แล้ว'); }
  };

  if (v === null) return <Empty>กำลังโหลด…</Empty>;
  if (v === false) return <Empty>ไม่พบข้อมูล หรือไม่มีสิทธิ์เข้าถึง</Empty>;

  const a = v.address || {};
  const needs = (v.answers.needs || []).map((n) => NEEDS.find((x) => x.id === n)).filter(Boolean);

  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">{`${v.title || ''}${v.first_name || ''} ${v.last_name || ''}`.trim() || 'ไม่ระบุชื่อ'}</h1>
            <div className="text-sm text-neutral-500">บันทึกโดย {v.creator?.name} · {timeAgo(v.created_at)}</div>
          </div>
          <LevelBadge level={v.level} big />
        </div>
        {v.override_level && <div className="text-sm rounded-lg bg-goldpale p-2">ปรับระดับเป็น “{v.override_level}” เพราะ: {v.override_reason}</div>}
        <Row k="ที่อยู่">{addressLine(a)}</Row>
        <Row k="โทรศัพท์">{v.phone && <a className="text-golddark underline" href={`tel:${v.phone}`}>{v.phone}</a>}</Row>
        <Row k="เลขบัตร">{v.national_id}</Row>
        <Row k="อายุ">{v.age && `${v.age} ปี`}</Row>
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

      {v.can_print && (
        <Section title="แบบคำร้องขอรับเงินช่วยเหลือ" hint="สร้างลิงก์ให้ อบต./ศูนย์ช่วยเหลือ เปิดและพิมพ์แบบคำร้องที่กรอกไว้แล้ว ไม่ต้องเข้าสู่ระบบ">
          <div className="text-sm space-y-1">
            <Row k="ที่อยู่อาศัย">{RESIDENCE_TYPES[v.residence_type]}{v.residence_other ? ` (${v.residence_other})` : ''}</Row>
            <Row k="น้ำท่วม">{v.flood_from && `${v.flood_from} ถึง ${v.flood_to || '…'}`}</Row>
            <Row k="กรณี">{v.relief_case && `กรณีที่ ${v.relief_case}: ${RELIEF_CASES[v.relief_case]}`}</Row>
            <Row k="พร้อมเพย์">{v.promptpay && (v.promptpay === 'yes' ? 'มี' : 'ไม่มี')}</Row>
            <Row k="หลักฐาน">{v.evidence.map((e) => EVIDENCE[e]).join(', ')}</Row>
          </div>
          {!link ? (
            <button onClick={makeLink} className="btn-primary w-full">🖨️ สร้างลิงก์พิมพ์แบบคำร้อง</button>
          ) : (
            <div className="space-y-2 text-center">
              {qr && <img src={qr} alt="QR" className="mx-auto w-48 h-48" />}
              <div className="text-xs text-neutral-500 break-all">{link.url}</div>
              <div className="text-xs text-neutral-500">ใช้ได้ถึง {new Date(link.expires).toLocaleDateString('th-TH', { dateStyle: 'long' })}</div>
              <div className="grid grid-cols-2 gap-2">
                <a href={link.url} target="_blank" rel="noreferrer" className="btn-gold">เปิดแบบคำร้อง</a>
                <button onClick={share} className="btn-ghost">ส่งลิงก์</button>
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
