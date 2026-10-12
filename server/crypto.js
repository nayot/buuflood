// Field encryption for personal data (phone, LINE, email).
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

/** A Thai ID number is 13 digits whose last is a check digit. */
export function validThaiId(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length !== 13) return null;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(d[12]) ? d : null;
}

/** One-way code of an ID number, keyed with DATA_KEY and the activity, so the same card is recognised within an
 *  activity but codes can't be reversed or linked across activities. */
export const idCode = (activityId, idNumber) =>
  crypto.createHmac('sha256', key()).update(`idcard:${Number(activityId)}:${idNumber}`).digest('base64url').slice(0, 32);
export const ID_CODE_RE = /^[A-Za-z0-9_-]{32}$/;

export const maskPhone = (p) => (p ? `${p.slice(0, 3)}-xxx-${p.slice(-4)}` : null);
