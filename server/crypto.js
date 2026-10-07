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

export const maskPhone = (p) => (p ? `${p.slice(0, 3)}-xxx-${p.slice(-4)}` : null);
