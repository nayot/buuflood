import { HOTLINES } from '../../../shared/mental.js';

// Local numbers (EMERGENCY_CONTACTS on the server) are cached so the panel still shows them offline.
export function rememberLocalContacts(list) {
  try { if (Array.isArray(list)) localStorage.setItem('emergency', JSON.stringify(list)); } catch { /* private mode */ }
}
const localContacts = () => { try { return JSON.parse(localStorage.getItem('emergency') || '[]'); } catch { return []; } };

/** Red mental-health result: call for help now. Every number is a tap-to-call button. */
export default function EmergencyPanel({ advice }) {
  const all = [...HOTLINES, ...localContacts()];
  return (
    <div className="rounded-xl border-2 border-lvred bg-red-50 p-3 space-y-2" role="alert">
      <div className="font-bold text-lvred text-lg">🚨 ระดับแดง: โทรขอความช่วยเหลือทันที</div>
      {advice && <p className="text-sm">{advice}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {all.map((c) => (
          <a key={`${c.label}${c.tel}`} href={`tel:${c.tel}`} className="flex items-center justify-between gap-2 rounded-xl bg-lvred text-white px-4 py-3">
            <span className="text-sm min-w-0">{c.label}</span>
            <span className="text-xl font-bold whitespace-nowrap">📞 {c.tel}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
