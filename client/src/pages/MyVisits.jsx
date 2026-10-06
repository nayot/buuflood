import { useEffect, useState } from 'react';
import { api, addressLine, timeAgo } from '../lib/api.js';
import { pending, flush, onOutboxChange } from '../lib/outbox.js';
import { CATEGORIES, TICKET_STATUS } from '../../../shared/triage.js';
import { LevelBadge, Empty } from '../components/ui.jsx';

export default function MyVisits({ me }) {
  const [rows, setRows] = useState(null);
  const [queued, setQueued] = useState([]);
  const [all, setAll] = useState(false);
  const canAll = ['admin', 'office'].includes(me.role);

  const load = () => api(`api/visits${all ? '' : '?mine=1'}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [all]);
  useEffect(() => onOutboxChange(() => { pending().then(setQueued); load(); }), [all]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-xl font-bold">{all ? 'บันทึกทั้งหมด' : 'บันทึกของฉัน'}</h1>
        {canAll && (
          <button onClick={() => setAll(!all)} className="text-sm text-golddark underline">{all ? 'ดูเฉพาะของฉัน' : 'ดูทั้งหมด'}</button>
        )}
      </div>

      {queued.length > 0 && (
        <div className="card bg-goldpale space-y-2">
          <div className="font-semibold">ยังไม่ได้ส่ง {queued.length} รายการ</div>
          {queued.map((q) => (
            <div key={q.uuid} className="text-sm flex justify-between gap-2">
              <span>{q.data.first_name || 'ไม่ระบุชื่อ'} {q.data.last_name}</span>
              <span className={q.failed ? 'text-lvred' : 'text-neutral-500'}>{q.failed ? `ส่งไม่ได้: ${q.failed}` : 'รอสัญญาณ'}</span>
            </div>
          ))}
          <button onClick={() => flush()} className="btn-primary w-full">ส่งตอนนี้</button>
        </div>
      )}

      {rows === null ? <Empty>กำลังโหลด…</Empty> : rows.length === 0 ? <Empty>ยังไม่มีบันทึก</Empty> : rows.map((r) => (
        <a key={r.id} href={`#/visit/${r.id}`} className="card block space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">{r.name || 'ไม่ระบุชื่อ'}</div>
            <LevelBadge level={r.level} />
          </div>
          <div className="text-sm text-neutral-500">{addressLine(r.address) || '—'} · {timeAgo(r.created_at)}</div>
          {r.tickets.length > 0 && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {r.tickets.map((t) => (
                <span key={t.id} className="rounded-full bg-neutral-100 px-2 py-0.5">
                  {CATEGORIES[t.category]?.icon} {CATEGORIES[t.category]?.label}: {TICKET_STATUS[t.status]}
                </span>
              ))}
            </div>
          )}
        </a>
      ))}
    </div>
  );
}
