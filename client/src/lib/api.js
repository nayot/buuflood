// All URLs are relative so the app works under any sub-path (e.g. /buuflood/).
export class ApiError extends Error {
  constructor(status, body) { super(body?.error || `HTTP ${status}`); this.status = status; this.body = body; }
}

export async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data);
  return data;
}

export const mapsLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
export const directionsLink = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

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
