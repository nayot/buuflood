import { Q2, Q9, Q9_SCALE, Q8, Q8_CONTROL, MENTAL_ADVICE, scoreMental } from '../../../shared/mental.js';
import { LevelBadge } from './ui.jsx';
import EmergencyPanel from './Emergency.jsx';

export const blankMental = () => ({ q2: [null, null], q9: Array(9).fill(null), q8: Array(8).fill(null), q8_control: null });

function YesNo({ value, onChange, yes = 'มี', no = 'ไม่มี' }) {
  return (
    <div className="grid grid-cols-2 gap-2 mt-1.5">
      {[[true, yes], [false, no]].map(([v, l]) => (
        <button key={l} type="button" onClick={() => onChange(v)}
          className={`rounded-xl border px-3 py-2 ${value === v ? 'border-golddark bg-goldpale font-bold' : 'border-neutral-200 bg-white'}`}>{l}</button>
      ))}
    </div>
  );
}

const Q = ({ n, children, done }) => (
  <div className={`rounded-xl border p-3 ${done ? 'border-neutral-200' : 'border-golddark'}`}>
    <div className="text-sm"><b>{n}.</b> {children}</div>
  </div>
);

/**
 * 2Q → 9Q → 8Q of the Department of Mental Health. Each step appears only when the previous one calls for it.
 * Read each question exactly as written, one at a time; repeat it if not understood, without explaining it.
 * `crisis`: the volunteer ticked m_crisis, which is red whatever the screening says, so the call panel shows at once.
 */
export default function MentalScreen({ value, onChange, crisis = false }) {
  const m = value || blankMental();
  const r = scoreMental(m);
  const set = (k, i, v) => onChange({ ...m, [k]: m[k].map((x, j) => (j === i ? v : x)) });
  const level = crisis ? 'red' : r.level;

  return (
    <div className="space-y-3 rounded-xl bg-neutral-50 p-3 border border-neutral-200">
      <div>
        <div className="font-bold">💛 แบบคัดกรองสุขภาพใจ (2Q 9Q 8Q)</div>
        <p className="text-xs text-neutral-500">อ่านคำถามตามที่เขียน ถามทีละข้อ ถ้าไม่เข้าใจให้ถามซ้ำ ไม่อธิบายขยายความ ถามในที่ที่เป็นส่วนตัว</p>
      </div>
      {crisis && <EmergencyPanel advice={`${MENTAL_ADVICE.red} แล้วจึงทำแบบคัดกรองต่อเมื่อปลอดภัย`} />}

      <div className="space-y-2">
        <div className="font-semibold text-sm">2Q: คัดกรองโรคซึมเศร้า</div>
        {Q2.map((q, i) => (
          <Q key={q} n={i + 1} done={m.q2[i] != null}>{q}<YesNo value={m.q2[i]} onChange={(v) => set('q2', i, v)} /></Q>
        ))}
      </div>

      {r.need9 && (
        <div className="space-y-2">
          <div className="font-semibold text-sm">9Q: ใน 2 สัปดาห์ที่ผ่านมารวมวันนี้ ท่านมีอาการเหล่านี้บ่อยแค่ไหน</div>
          {Q9.map((q, i) => (
            <Q key={q} n={i + 1} done={m.q9[i] != null}>
              {q}
              <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                {Q9_SCALE.map((l, score) => (
                  <button key={l} type="button" onClick={() => set('q9', i, score)}
                    className={`rounded-lg border px-2 py-1.5 text-sm ${m.q9[i] === score ? 'border-golddark bg-goldpale font-bold' : 'border-neutral-200 bg-white'}`}>
                    {l} <span className="text-neutral-500">({score})</span>
                  </button>
                ))}
              </div>
            </Q>
          ))}
          {r.q9 != null && <div className="text-sm">คะแนน 9Q รวม <b>{r.q9}</b></div>}
        </div>
      )}

      {r.need8 && (
        <div className="space-y-2">
          <div className="font-semibold text-sm">8Q: ประเมินแนวโน้มการฆ่าตัวตาย</div>
          {Q8.map((q, i) => (
            <Q key={q.text} n={i + 1} done={m.q8[i] != null}>
              <span className="text-neutral-500">{q.when}</span> {q.text}
              <YesNo value={m.q8[i]} onChange={(v) => onChange({ ...m, q8: m.q8.map((x, j) => (j === i ? v : x)), ...(i === 2 && !v ? { q8_control: null } : {}) })} />
              {i === 2 && m.q8[2] === true && (
                <div className="mt-2 text-sm">
                  ถามต่อ: {Q8_CONTROL}
                  <YesNo value={m.q8_control} onChange={(v) => onChange({ ...m, q8_control: v })} yes="ได้" no="ไม่ได้" />
                </div>
              )}
            </Q>
          ))}
        </div>
      )}

      {r.complete ? (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold">ผลคัดกรองสุขภาพใจ</span>
            <LevelBadge level={level} />
          </div>
          <div className="text-sm">{r.summary}{crisis && ' · มีภาวะวิกฤตทางใจ (ระดับแดง)'}</div>
          {r.flags.length > 0 && <div className="text-sm text-lvred font-semibold">{r.flags.join(' · ')}</div>}
          {level === 'red'
            ? !crisis && <EmergencyPanel advice={MENTAL_ADVICE.red} />
            : <p className={`text-sm rounded-lg p-2 ${level === 'yellow' ? 'bg-goldpale' : 'bg-green-50'}`}>{MENTAL_ADVICE[level]}</p>}
        </div>
      ) : (
        <p className="text-sm text-golddark">ตอบให้ครบทุกข้อที่แสดงจึงจะบันทึกได้</p>
      )}
    </div>
  );
}
