// Mental-health referral to the BUU Flood Help LINE Official Account (yellow screening results).
//
// The volunteer shows a QR code that opens the OA chat with "รหัสส่งต่อ BF-XXXXX" typed in; the villager sends it.
// The phone registers the referral with that code (POST api/line-referrals) as soon as the volunteer ticks the option,
// and again with the saved visit, which is authoritative. When the code arrives through the webhook the bot replies in
// that chat with the greeting for the screening level (line-greetings.js) and the brief for the professional who takes
// over in LINE OA Manager. Replies are free and work before the villager adds the OA as a friend, so the early
// registration is the main path. If the code arrives first (no signal at the house), the bot replies with the greeting
// for a level not yet known and pushes the brief once the visit is uploaded.
//
// Test-mode codes start with BT- and live in the sandbox database: the webhook has no session, so it picks the
// database from the code. Every function here takes the database explicitly; nothing runs on the request proxy after
// an await.
import crypto from 'node:crypto';
import { prodDb, sandboxDb, json } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { scoreMental, cleanMental } from '../shared/mental.js';
import { cleanPhone, cleanLine } from '../shared/contact.js';
import { parseCode, LEVEL_WORD } from '../shared/line.js';
import { greeting } from './line-greetings.js';

const SECRET = process.env.LINE_CHANNEL_SECRET || '';
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
export const LINE_OA = (process.env.LINE_OA_ID || '').trim();
const API = (process.env.LINE_API_BASE || 'https://api.line.me').replace(/\/$/, '');
export const lineEnabled = !!(SECRET && TOKEN && LINE_OA);

const str = (v, max = 100) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const AREA_KEYS = ['house_no', 'moo', 'village', 'tambon', 'amphoe', 'province'];

// ---------------------------------------------------------------- messages

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function thaiTime(sql) {
  const t = new Date(`${String(sql).replace(' ', 'T')}Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'numeric',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(t).map((x) => [x.type, x.value]));
  return `${Number(p.day)} ${MONTHS[p.month - 1]} ${Number(p.year) + 543} ${p.hour}:${p.minute} น.`;
}

function brief(r, test) {
  const a = json(r.area, {});
  const m = json(r.mental, {});
  const area = [a.house_no && `บ้านเลขที่ ${a.house_no}`, a.moo && `หมู่ ${a.moo}`, a.village, a.tambon && `ต.${a.tambon}`,
    a.amphoe && `อ.${a.amphoe}`, a.province && `จ.${a.province}`].filter(Boolean).join(' ');
  const phone = decrypt(r.phone_enc);
  const line = decrypt(r.line_enc);
  return [
    `${test ? '[ทดสอบ] ' : ''}📋 ข้อมูลส่งต่อจากอาสาสมัคร โครงการบูรพาร่วมฟื้นฟูหลังน้ำท่วม`,
    `รหัส: ${r.code}`,
    `ชื่อ: ${[r.first_name, r.last_name].filter(Boolean).join(' ') || '-'}`,
    `ติดต่อ: ${[phone && `โทร ${phone}`, line && `LINE ${line}`].filter(Boolean).join(' · ') || '-'}`,
    `พื้นที่: ${area || '-'}`,
    `ผลคัดกรองสุขภาพใจ: ${LEVEL_WORD[m.level] || '-'}`,
    m.summary ? `${m.summary}` : null,
    `อาสาสมัคร: ${r.volunteer || '-'}`,
    `บันทึกเมื่อ: ${thaiTime(r.updated_at || r.created_at)}`,
  ].filter(Boolean).join('\n');
}

async function callLine(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`LINE ${path} HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
}
const text = (t) => ({ type: 'text', text: t.slice(0, 5000) });

// ---------------------------------------------------------------- referrals

const isTest = (code) => code.startsWith('BT-');
const dbFor = (code) => (isTest(code) ? sandboxDb() : prodDb);

const getRef = (d, code) => d.prepare(`SELECT r.*, u.name AS volunteer FROM line_referrals r
  LEFT JOIN users u ON u.id = r.created_by WHERE r.code = ?`).get(code);

/** Mental summary kept with the referral (the brief is rendered at send time, so no plaintext contacts are stored). */
export const mentalOf = (scored) => JSON.stringify({ level: scored.level, summary: scored.summary, q9: scored.q9, q8: scored.q8, flags: scored.flags });

/**
 * Create or refresh a referral's details. `fromVisit` details win over the early registration, and the LINE side
 * (user, status) is never touched here. Returns null, or an error code for a 4xx.
 */
export function upsertReferral(d, { code, userId, visitId = null, visitUuid = null, person, mental }) {
  const existing = d.prepare('SELECT created_by, visit_id FROM line_referrals WHERE code = ?').get(code);
  if (existing?.created_by && existing.created_by !== userId) return 'code taken';
  if (existing?.visit_id && !visitId) return null; // the saved visit already filled it in
  const area = Object.fromEntries(AREA_KEYS.map((k) => [k, str(person.address?.[k])]));
  d.prepare(`INSERT INTO line_referrals (code, created_by, visit_id, visit_uuid, first_name, last_name, phone_enc, line_enc, area, mental)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET created_by = excluded.created_by, visit_id = COALESCE(excluded.visit_id, visit_id),
      visit_uuid = COALESCE(excluded.visit_uuid, visit_uuid), first_name = excluded.first_name, last_name = excluded.last_name,
      phone_enc = excluded.phone_enc, line_enc = excluded.line_enc, area = excluded.area, mental = excluded.mental,
      updated_at = datetime('now')`).run(code, userId, visitId, visitUuid, str(person.first_name), str(person.last_name),
    encrypt(cleanPhone(person.phone)), encrypt(cleanLine(person.line)), JSON.stringify(area), mental);
  return null;
}

/** Close the visit's mental-health ticket as referred once the villager is in the LINE chat. */
export function markReferred(d, code) {
  const r = d.prepare('SELECT visit_id, created_by, line_user_enc FROM line_referrals WHERE code = ?').get(code);
  if (!r?.visit_id || !r.line_user_enc) return;
  const t = d.prepare("SELECT id FROM tickets WHERE visit_id = ? AND category = 'mental' AND status NOT IN ('done','referred')").get(r.visit_id);
  if (!t) return;
  d.prepare("UPDATE tickets SET status = 'referred', updated_at = datetime('now') WHERE id = ?").run(t.id);
  d.prepare('INSERT INTO ticket_updates (ticket_id, user_id, status, note) VALUES (?, ?, ?, ?)')
    .run(t.id, r.created_by, 'referred', `ผู้ประสบภัยเข้าแชท BUU Flood Help (LINE) แล้ว รหัส ${code} ผู้เชี่ยวชาญดูแลต่อทาง LINE`);
}

/** Send the brief if the villager is linked and it has not gone out yet. `replyToken`: answer the webhook event. */
export async function deliver(d, code, replyToken = null) {
  const r = getRef(d, code);
  if (!r || r.status === 'sent' || !r.line_user_enc) return;
  const test = isTest(code);
  const hasDetails = !!r.mental;
  const hello = text(greeting(hasDetails ? json(r.mental, {}) : null, test)); // the level picks the nursing team's wording
  try {
    if (replyToken) {
      await callLine('/v2/bot/message/reply', { replyToken, messages: hasDetails ? [hello, text(brief(r, test))] : [hello] });
    } else if (hasDetails) {
      await callLine('/v2/bot/message/push', { to: decrypt(r.line_user_enc), messages: [text(brief(r, test))] });
    }
    if (!d.isOpen) return;
    if (hasDetails) d.prepare("UPDATE line_referrals SET status = 'sent', sent_at = datetime('now'), error = NULL WHERE code = ?").run(code);
  } catch (e) {
    console.warn(`line: ${code}: ${e.message}`);
    if (d.isOpen) d.prepare("UPDATE line_referrals SET status = 'failed', error = ? WHERE code = ?").run(e.message.slice(0, 300), code);
  }
}

// ---------------------------------------------------------------- webhook

const validSignature = (raw, sig) => {
  if (!raw || !sig) return false;
  const mine = Buffer.from(crypto.createHmac('sha256', SECRET).update(raw).digest('base64'));
  const theirs = Buffer.from(String(sig));
  return mine.length === theirs.length && crypto.timingSafeEqual(mine, theirs);
};

async function onEvent(ev) {
  if (ev.type !== 'message' || ev.message?.type !== 'text' || !ev.source?.userId) return;
  const code = parseCode(ev.message.text);
  if (!code) return; // ordinary chat with the professionals
  const d = dbFor(code);
  const r = d.prepare('SELECT line_user_enc, status FROM line_referrals WHERE code = ?').get(code);
  if (r?.line_user_enc) {
    // Redelivered event, or the code sent twice: answer once only.
    if (r.status === 'sent' || ev.deliveryContext?.isRedelivery) return;
    if (decrypt(r.line_user_enc) !== ev.source.userId) return;
  }
  if (r) d.prepare("UPDATE line_referrals SET line_user_enc = ?, linked_at = datetime('now'), status = CASE WHEN status = 'sent' THEN status ELSE 'linked' END WHERE code = ?")
    .run(encrypt(ev.source.userId), code);
  else d.prepare("INSERT INTO line_referrals (code, line_user_enc, linked_at, status) VALUES (?, ?, datetime('now'), 'linked')")
    .run(code, encrypt(ev.source.userId));
  markReferred(d, code);
  await deliver(d, code, ev.replyToken);
}

export function mountLine(app, { need }) {
  // Not under /api: no session and no test-mode header. LINE's "Verify" button sends an empty event list.
  app.post('/line/webhook', (req, res) => {
    if (!lineEnabled) return res.status(404).end();
    if (!validSignature(req.rawBody, req.get('x-line-signature'))) return res.status(401).end();
    res.sendStatus(200); // answer first: LINE redelivers when a webhook is slow
    for (const ev of req.body?.events || []) onEvent(ev).catch((e) => console.warn(`line webhook: ${e.message}`));
  });

  // Early registration from the visit form, as soon as the volunteer shows the QR code.
  app.post('/api/line-referrals', need(), (req, res) => {
    if (!lineEnabled) return res.status(404).json({ error: 'line off' });
    const b = req.body || {};
    const code = parseCode(b.code);
    if (!code || b.code !== code || isTest(code) !== req.test) return res.status(400).json({ error: 'code' });
    if (b.consent !== true) return res.status(400).json({ error: 'consent' });
    const scored = scoreMental(cleanMental(b.mental));
    if (!scored.complete || scored.level !== 'yellow') return res.status(400).json({ error: 'not yellow' });
    const d = req.dbx;
    const err = upsertReferral(d, { code, userId: req.user.id, visitUuid: str(b.visit_uuid), person: b, mental: mentalOf(scored) });
    if (err) return res.status(409).json({ error: err });
    res.json({ ok: true, status: d.prepare('SELECT status FROM line_referrals WHERE code = ?').get(code).status });
    deliver(d, code);
  });
}

/** Referral status for the visit page. */
export function referralOfVisit(d, visitId) {
  const r = d.prepare('SELECT code, status, error, linked_at, sent_at FROM line_referrals WHERE visit_id = ?').get(visitId);
  return r || null;
}
