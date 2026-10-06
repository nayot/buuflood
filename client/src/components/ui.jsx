import { LEVEL_LABELS } from '../../../shared/triage.js';

const LEVEL_STYLE = {
  red: 'bg-lvred text-white',
  yellow: 'bg-lvyellow text-ink',
  green: 'bg-lvgreen text-white',
};
export const LEVEL_COLOR = { red: '#C0392B', yellow: '#E0A800', green: '#2E8B57' };

export function LevelBadge({ level, big }) {
  if (!level) return <span className="rounded-full bg-neutral-200 px-2.5 py-0.5 text-xs">ยังไม่คัดกรอง</span>;
  return (
    <span className={`inline-block rounded-full font-bold ${LEVEL_STYLE[level]} ${big ? 'px-4 py-1.5 text-base' : 'px-2.5 py-0.5 text-xs'}`}>
      {LEVEL_LABELS[level]}
    </span>
  );
}

export function Section({ title, children, hint }) {
  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-bold text-lg">{title}</h2>
        {hint && <p className="text-sm text-neutral-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children, className = '' }) {
  return <label className={`block ${className}`}><span className="label">{label}</span>{children}</label>;
}

export function Check({ checked, onChange, children, dot }) {
  return (
    <label className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${checked ? 'border-golddark bg-goldpale' : 'border-neutral-200 bg-white'}`}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span className="flex-1">{children}</span>
      {dot && <span className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: LEVEL_COLOR[dot] }} />}
    </label>
  );
}

export function Radio({ name, value, current, onChange, children }) {
  return (
    <label className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${current === value ? 'border-golddark bg-goldpale' : 'border-neutral-200 bg-white'}`}>
      <input type="radio" name={name} checked={current === value} onChange={() => onChange(value)} className="mt-0.5" />
      <span className="flex-1">{children}</span>
    </label>
  );
}

export function Empty({ children }) {
  return <div className="card text-center text-neutral-500 py-10">{children}</div>;
}
