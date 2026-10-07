// All URLs are relative so the app works under any sub-path (e.g. /buuflood/).
export class ApiError extends Error {
  constructor(status, body) { super(body?.error || `HTTP ${status}`); this.status = status; this.body = body; }
}

// Admin test mode, as last reported by api/me. Every change is sent with the mode the screen shows; the server
// answers 409 when it differs (e.g. test mode expired), and the app reloads the mode instead of saving.
let testMode = null;
export const setTestMode = (on) => { testMode = on; };
export const MODE_CHANGED = 'buuflood:mode';

export async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (testMode != null) opts.headers['X-Test-Mode'] = testMode ? '1' : '0';
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (r.status === 409 && data.error === 'mode') window.dispatchEvent(new Event(MODE_CHANGED));
  if (!r.ok) throw new ApiError(r.status, data);
  return data;
}

export const mapsLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
export const directionsLink = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

// Links for a visit or ticket: use the map position when there is one, otherwise let Google Maps find the address.
const hasPos = (v) => v && v.lat != null && v.lng != null;
const addressQuery = (a = {}) => [a.house_no, a.moo && `หมู่ ${a.moo}`, a.village, a.soi && `ซอย ${a.soi}`, a.road && `ถนน ${a.road}`,
  a.tambon && `ตำบล ${a.tambon}`, a.amphoe && `อำเภอ ${a.amphoe}`, a.province && `จังหวัด ${a.province}`].filter(Boolean).join(' ');
export const placeLink = (v) => (hasPos(v) ? mapsLink(v.lat, v.lng)
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressQuery(v?.address))}`);
export const navLink = (v) => (hasPos(v) ? directionsLink(v.lat, v.lng)
  : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressQuery(v?.address))}`);
export const canLocate = (v) => hasPos(v) || !!(v?.address?.tambon || v?.address?.amphoe);

/** Approximate position of an address (OpenStreetMap Nominatim). Returns null when not found or offline. */
export async function geocode(a = {}) {
  const tries = [
    [a.village, a.tambon && `ตำบล${a.tambon}`, a.amphoe && `อำเภอ${a.amphoe}`, a.province && `จังหวัด${a.province}`],
    [a.tambon && `ตำบล${a.tambon}`, a.amphoe && `อำเภอ${a.amphoe}`, a.province && `จังหวัด${a.province}`],
    [a.amphoe && `อำเภอ${a.amphoe}`, a.province && `จังหวัด${a.province}`],
  ].map((t) => t.filter(Boolean).join(' ')).filter(Boolean);
  for (const q of [...new Set(tries)]) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=th&accept-language=th&q=${encodeURIComponent(q)}`);
      const [hit] = await r.json();
      if (hit) return { lat: +(+hit.lat).toFixed(6), lng: +(+hit.lon).toFixed(6) };
    } catch { return null; }
  }
  return null;
}

export function addressLine(a = {}) {
  return [a.house_no && `เลขที่ ${a.house_no}`, a.moo && `หมู่ ${a.moo}`, a.village, a.soi && `ซ.${a.soi}`, a.road && `ถ.${a.road}`,
    a.tambon && `ต.${a.tambon}`, a.amphoe && `อ.${a.amphoe}`, a.province && `จ.${a.province}`].filter(Boolean).join(' ');
}

export function timeAgo(sqlTime) {
  if (!sqlTime) return '';
  const t = new Date(sqlTime.replace(' ', 'T') + (sqlTime.endsWith('Z') ? '' : 'Z')).getTime();
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'เมื่อสักครู่';
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  return `${Math.round(h / 24)} วันที่แล้ว`;
}

// Thai national ID checksum (13 digits).
export function validThaiId(id) {
  const d = String(id).replace(/\D/g, '');
  if (d.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(d[12]);
}
