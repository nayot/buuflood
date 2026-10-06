// Field encryption for personal data (national ID, phone) and signed print links.
import crypto from 'node:crypto';

function key() {
  const raw = process.env.DATA_KEY;
  if (!raw) throw new Error('DATA_KEY is not set (openssl rand -base64 32)');
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('DATA_KEY must be 32 bytes, base64-encoded');
  return k;
}

export function encrypt(text) {
  if (text == null || text === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(blob) {
  if (!blob) return null;
  const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

export const maskId = (id) => (id ? `${id.slice(0, 1)}-xxxx-xxxxx-${id.slice(10, 12)}-${id.slice(12)}` : null);
export const maskPhone = (p) => (p ? `${p.slice(0, 3)}-xxx-${p.slice(-4)}` : null);

// Print links: "<visitId>.<expiresEpochSec>.<hmac>" — no login needed, expires on its own.
const sign = (payload) =>
  crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');

export function makePrintToken(visitId, days = Number(process.env.PRINT_LINK_DAYS || 14)) {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const payload = `${visitId}.${exp}`;
  return { token: `${payload}.${sign(payload)}`, expires: new Date(exp * 1000).toISOString() };
}

export function readPrintToken(token) {
  const [id, exp, mac] = String(token).split('.');
  if (!id || !exp || !mac) return null;
  const good = sign(`${id}.${exp}`);
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  if (Number(exp) * 1000 < Date.now()) return null;
  return Number(id);
}
