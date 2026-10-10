// BUU Flood Recovery — triage web app server.
import 'dotenv/config';
import express from 'express';
import cookieSession from 'cookie-session';
import multer from 'multer';
import { OAuth2Client } from 'google-auth-library';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, prodDb, json, withDb, uploadDir, sandboxDb, sandboxOpen, syncSandboxUsers, resetSandbox } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { geocodePending } from './geocode.js';
import { mountRepairs, itemsError, itemsOfVisit, removeFiles } from './repairs.js';
import { mountLine, lineEnabled, LINE_OA, upsertReferral, mentalOf, markReferred, deliver, referralOfVisit } from './line.js';
import { parseCode } from '../shared/line.js';
import { triage, ticketsFor, needsMentalScreening, CATEGORIES, LEVELS, TICKET_STATUS, NEEDS, parseSpecialties } from '../shared/triage.js';
import { cleanMental } from '../shared/mental.js';
import { contactError, cleanPhone, cleanLine, cleanEmail } from '../shared/contact.js';
import { ITEMS_MAX, ITEM_PHOTOS_MAX, REPAIR_TYPES, queueNo } from '../shared/repairs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BASE_PATH = new URL(PUBLIC_URL).pathname.replace(/\/$/, '') || '';
const DOMAINS = (process.env.ALLOWED_DOMAINS || 'go.buu.ac.th,eng.buu.ac.th').split(',').map((s) => s.trim().toLowerCase());
// New accounts from these domains start as `pending` and can do nothing until an admin gives them a role
// (e.g. gmail.com, which anyone can have).
const APPROVAL_DOMAINS = (process.env.APPROVAL_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ADMINS = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const DEV_AUTH = !PROD && process.env.DEV_AUTH === '1';
// Local numbers for the red mental-health panel, e.g. "ผู้ประสานงานภาคสนาม=0812345678;รพ.ท่าใหม่=039xxxxxx".
const EMERGENCY = (process.env.EMERGENCY_CONTACTS || '').split(';').map((s) => s.split('='))
  .filter(([label, tel]) => label?.trim() && tel?.trim()).map(([label, tel]) => ({ label: label.trim(), tel: tel.trim().replace(/[^\d+]/g, '') }));

for (const k of ['SESSION_SECRET', 'DATA_KEY']) {
  if (!process.env[k]) { console.error(`Missing ${k} in .env — see .env.example`); process.exit(1); }
}

const oauth = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${PUBLIC_URL}/auth/callback`);

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } })); // raw body: LINE webhook signature
app.use(cookieSession({
  name: 'buuflood',
  secret: process.env.SESSION_SECRET,
  path: `${BASE_PATH}/`,
  httpOnly: true,
  sameSite: 'lax',
  secure: PUBLIC_URL.startsWith('https://'),
  maxAge: 14 * 86400 * 1000,
}));

// ---------------------------------------------------------------- database of this request (production or test mode)

// Admin test mode: everything the admin does goes to the sandbox database (DATA_DIR/sandbox), never to production.
// The flag lives in the signed session cookie, so photo and CSV links follow it too, and it expires on its own.
const TEST_HOURS = 8;
app.use((req, res, next) => {
  const uid = req.session?.uid;
  req.prodUser = uid ? prodDb.prepare('SELECT * FROM users WHERE id = ?').get(uid) : null;
  req.test = req.prodUser?.role === 'admin' && req.session.testUntil > Date.now();
  if (req.session?.testUntil && !req.test) req.session.testUntil = null;
  req.dbx = req.test ? sandboxDb() : prodDb;
  withDb(req.dbx, () => {
    req.uploadDir = uploadDir();
    req.user = req.prodUser;
    if (req.test) {
      const get = () => db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
      req.user = get() || (syncSandboxUsers(), get());
    }
    // The client says which mode it thinks it is in; a change it has not seen yet (e.g. test mode expired)
    // must not send its next action to the other database.
    const expect = req.get('X-Test-Mode');
    if (req.method !== 'GET' && req.path.startsWith('/api/') && expect != null && (expect === '1') !== req.test) {
      return res.status(409).json({ error: 'mode', test: req.test });
    }
    next();
  });
});

// ---------------------------------------------------------------- auth

const allowedEmail = (email) => DOMAINS.includes(String(email).toLowerCase().split('@')[1]);

function upsertUser({ email, name, picture }) {
  email = email.toLowerCase();
  const existing = prodDb.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) {
    const role = ADMINS.includes(email) ? 'admin' : existing.role;
    prodDb.prepare("UPDATE users SET name = ?, picture = ?, role = ?, last_login = datetime('now') WHERE id = ?")
      .run(name || existing.name, picture || existing.picture, role, existing.id);
    return existing.id;
  }
  const role = ADMINS.includes(email) ? 'admin' : APPROVAL_DOMAINS.includes(email.split('@')[1]) ? 'pending' : 'volunteer';
  return Number(prodDb.prepare("INSERT INTO users (email, name, picture, role, last_login) VALUES (?, ?, ?, ?, datetime('now'))")
    .run(email, name || email, picture || null, role).lastInsertRowid);
}

app.get('/auth/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  res.redirect(oauth.generateAuthUrl({ scope: ['openid', 'email', 'profile'], prompt: 'select_account', state }));
});

app.get('/auth/callback', async (req, res) => {
  try {
    if (!req.query.code || req.query.state !== req.session.oauthState) throw new Error('bad state');
    const { tokens } = await oauth.getToken(String(req.query.code));
    const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p.email_verified || !allowedEmail(p.email)) {
      return res.redirect(`${PUBLIC_URL}/#/login?error=domain`);
    }
    req.session = { uid: upsertUser(p) };
    res.redirect(`${PUBLIC_URL}/#/`);
  } catch (e) {
    console.error('OAuth error:', e.message);
    res.redirect(`${PUBLIC_URL}/#/login?error=oauth`);
  }
});

if (DEV_AUTH) {
  // Local testing only: /auth/dev?email=someone@eng.buu.ac.th&role=responder&specialty=electrical,structural
  app.get('/auth/dev', (req, res) => {
    const email = String(req.query.email || 'dev@eng.buu.ac.th');
    if (!allowedEmail(email)) return res.status(403).send('domain not allowed');
    const uid = upsertUser({ email, name: email.split('@')[0] });
    if (req.query.role) prodDb.prepare('UPDATE users SET role = ?, specialty = ? WHERE id = ?').run(String(req.query.role), parseSpecialties(req.query.specialty).join(',') || null, uid);
    req.session = { uid };
    res.redirect(`${PUBLIC_URL}/#/`);
  });
  console.log('DEV_AUTH enabled: /auth/dev?email=...');
}

app.post('/auth/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

const need = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'login' });
  if (req.prodUser.role === 'pending') return res.status(403).json({ error: 'pending' });
  if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
  next();
};

app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null, devAuth: DEV_AUTH, domains: DOMAINS });
  const { id, email, name, picture, role, specialty } = req.user;
  res.json({ user: { id, email, name, picture, role, specialty, specialties: parseSpecialties(specialty), realRole: req.prodUser.role,
    phone: decrypt(req.prodUser.phone_enc),
    pending_users: req.prodUser.role === 'admin' ? prodDb.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'pending'").get().n : 0,
    line_oa: lineEnabled ? LINE_OA : null },
    test: req.test ? { until: req.session.testUntil } : null, emergency: EMERGENCY });
});

// The volunteer's own phone. Kept on the production account in either mode (it is not test data).
// Pending accounts may add theirs too, so the admin can check who is asking.
app.post('/api/me/phone', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'login' });
  const phone = cleanPhone(req.body?.phone);
  if (phone.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'เบอร์โทรศัพท์ไม่ครบ' });
  prodDb.prepare('UPDATE users SET phone_enc = ? WHERE id = ?').run(encrypt(phone), req.prodUser.id);
  res.json({ ok: true, phone });
});

// ---------------------------------------------------------------- admin test mode

const realAdmin = (req, res, next) => (req.prodUser?.role === 'admin' ? next() : res.status(403).json({ error: 'forbidden' }));

app.post('/api/test-mode', realAdmin, (req, res) => {
  if (req.body?.on) {
    req.session.testUntil = Date.now() + TEST_HOURS * 3600 * 1000;
    syncSandboxUsers();
  } else req.session.testUntil = null;
  res.json({ ok: true });
});

// Test as another role: changes only the admin's own account inside the sandbox. Leaving test mode always works,
// because it is checked against the production role.
app.post('/api/test-mode/role', realAdmin, (req, res) => {
  if (!req.test) return res.status(409).json({ error: 'mode', test: false });
  const { role, specialty } = req.body || {};
  if (!['volunteer', 'responder', 'fixer', 'office', 'admin'].includes(role)) return res.status(400).json({ error: 'role' });
  const list = role === 'responder' ? parseSpecialties(specialty).join(',') || null : null;
  db.prepare('UPDATE users SET role = ?, specialty = ? WHERE id = ?').run(role, list, req.prodUser.id);
  res.json({ ok: true });
});

app.post('/api/test-mode/reset', realAdmin, (req, res) => {
  resetSandbox();
  res.json({ ok: true });
});

// ---------------------------------------------------------------- visits

// Photos of the house come as "photos" (old clients); photos of each item to repair as "item_<item uuid>".
const PHOTOS_MAX = 10;
const rawUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, req.uploadDir),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || '.jpg').toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: PHOTOS_MAX + ITEMS_MAX * ITEM_PHOTOS_MAX },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
}).any();
// Multer calls back from the request stream, outside the request's database context: put it back.
const upload = (req, res, next) => rawUpload(req, res, (err) => withDb(req.dbx, () => next(err)));

const str = (v, max = 200) => (v == null || v === '' ? null : String(v).slice(0, max));
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
/** Items to repair from the visit form, as stored in visits.repair_needs (already checked by itemsError). */
const needsOf = (items) => items.map((it) => ({ uuid: String(it.uuid), type: it.type,
  type_other: it.type === 'OT' ? str(it.type_other, 100) : null, brand: str(it.brand, 100), problem: str(it.problem, 500) }));

// Who may see a visit, and how much of it.
function access(user, visit) {
  if (!user || !visit) return null;
  if (user.role === 'admin' || user.role === 'office' || visit.created_by === user.id) return 'full';
  if (user.role === 'responder') return 'responder';
  return null;
}

// The 2Q/9Q/8Q answers are health data: only admins, the volunteer who asked them and mental-health responders
// see them. Everyone else who can open the visit sees the level and the 9Q/8Q totals.
const seesMentalDetail = (user, visit) => user.role === 'admin' || visit.created_by === user.id
  || (user.role === 'responder' && parseSpecialties(user.specialty).includes('mental'));

function serializeVisit(v, user) {
  const answers = json(v.answers, {});
  const tri = json(v.triage, {});
  if (!seesMentalDetail(user, v)) {
    delete answers.mental;
    if (tri.mental) tri.mental = { level: tri.mental.level, q9: tri.mental.q9, q8: tri.mental.q8, complete: tri.mental.complete };
    tri.reasons = (tri.reasons || []).filter((r) => !r.startsWith('สุขภาพใจ:'));
  }
  return {
    id: v.id, uuid: v.uuid, created_at: v.created_at, visited_at: v.visited_at, created_by: v.created_by,
    lat: v.lat, lng: v.lng, accuracy: v.accuracy,
    first_name: v.first_name, last_name: v.last_name,
    phone: decrypt(v.phone_enc), line: decrypt(v.line_enc), email: decrypt(v.email_enc), no_contact: !!v.no_contact,
    address: json(v.address, {}), answers, triage_level: v.triage_level, triage: tri,
    override_level: v.override_level, override_reason: v.override_reason, notes: v.notes,
    level: v.override_level || v.triage_level,
    location_source: v.location_source || 'gps',
  };
}

app.post('/api/visits', need(), upload, (req, res) => {
  const files = req.files || [];
  let d;
  try { d = JSON.parse(req.body.data || '{}'); } catch { removeFiles(files); return res.status(400).json({ error: 'bad data' }); }
  const fail = (error) => { removeFiles(files); return res.status(400).json({ error }); };
  if (!d.uuid) return fail('uuid required');
  // A visit queued on the phone in one mode is only accepted in that mode. 409: the outbox keeps it for later.
  if (!!d.test !== req.test) { removeFiles(files); return res.status(409).json({ error: 'mode', test: req.test }); }

  const dup = db.prepare('SELECT id FROM visits WHERE uuid = ?').get(String(d.uuid));
  if (dup) {
    removeFiles(files);
    return res.json({ id: dup.id, duplicate: true });
  }

  const answers = {
    needs: Array.isArray(d.answers?.needs) ? d.answers.needs.filter((n) => NEEDS.some((x) => x.id === n)) : [],
    cannot_travel: !!d.answers?.cannot_travel,
    other_need: str(d.answers?.other_need, 500),
  };
  if (needsMentalScreening(answers)) answers.mental = cleanMental(d.answers?.mental);
  const result = triage(answers);
  if (!str(d.first_name) || !str(d.last_name)) return fail('name required');
  if (contactError(d)) return fail('contact required');
  if (result.mental && !result.mental.complete) return fail('mental screening incomplete');
  const locationSource = d.location_source === 'address' ? 'address' : 'gps';
  const a0 = d.address || {};
  if (locationSource === 'address' && !(str(a0.tambon) && str(a0.amphoe) && str(a0.province) && (str(a0.house_no) || str(a0.moo)))) {
    return fail('address required');
  }
  const override = LEVELS.includes(d.override_level) ? d.override_level : null;
  if (override && !str(d.override_reason)) return fail('override reason required');
  const items = d.items || [];
  const itemErr = itemsError(items, files, { photoRequired: false });
  if (itemErr) return fail(itemErr);
  const housePhotos = files.filter((f) => f.fieldname === 'photos');
  if (housePhotos.length > PHOTOS_MAX) return fail('too many photos');
  // LINE referral: only for a yellow mental result with the villager's consent. A referral ticked before the answers
  // changed the level is dropped, not rejected.
  let referral = null;
  if (d.line_referral && lineEnabled && result.mental?.complete && result.mental.level === 'yellow' && !answers.needs.includes('m_crisis')) {
    const code = parseCode(d.line_referral.code);
    if (!code || code !== d.line_referral.code || code.startsWith('BT-') !== req.test) return fail('line code');
    if (d.line_referral.consent !== true) return fail('line consent');
    referral = code;
  }

  const a = d.address || {};
  const address = Object.fromEntries(['house_no', 'village', 'floor', 'moo', 'soi', 'road', 'tambon', 'amphoe', 'province'].map((k) => [k, str(a[k], 100)]));
  const name = `${str(d.first_name, 100)} ${str(d.last_name, 100)}`;

  db.exec('BEGIN');
  try {
    const visitId = Number(db.prepare(`INSERT INTO visits
      (uuid, created_by, visited_at, lat, lng, accuracy, first_name, last_name, phone_enc, line_enc, email_enc, no_contact,
       address, answers, triage_level, triage, override_level, override_reason, notes, location_source, repair_needs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      String(d.uuid), req.user.id, str(d.visited_at, 40), num(d.lat), num(d.lng), num(d.accuracy),
      str(d.first_name, 100), str(d.last_name, 100),
      encrypt(cleanPhone(d.phone)), encrypt(cleanLine(d.line)), encrypt(cleanEmail(d.email)), d.no_contact ? 1 : 0,
      JSON.stringify(address), JSON.stringify(answers), result.level, JSON.stringify(result), override,
      str(d.override_reason, 500), str(d.notes, 1000), locationSource, items.length ? JSON.stringify(needsOf(items)) : null,
    ).lastInsertRowid);

    const insT = db.prepare('INSERT INTO tickets (visit_id, category, level) VALUES (?, ?, ?)');
    for (const t of ticketsFor(result, override)) insT.run(visitId, t.category, t.level);
    const insP = db.prepare('INSERT INTO photos (visit_id, filename) VALUES (?, ?)');
    for (const f of housePhotos) insP.run(visitId, f.filename);
    // Items to repair are a record of needs only: no queue number, the owner registers at the Fixing Centre.
    const insI = db.prepare('INSERT INTO photos (visit_id, filename, item_uuid) VALUES (?, ?, ?)');
    for (const it of items) {
      for (const f of files.filter((x) => x.fieldname === `item_${it.uuid}`)) insI.run(visitId, f.filename, String(it.uuid));
    }
    if (referral) {
      const err = upsertReferral(db, { code: referral, userId: req.user.id, visitId, visitUuid: String(d.uuid),
        person: { ...d, address }, mental: mentalOf(result.mental) });
      if (err) throw Object.assign(new Error(err), { status: 400 });
      const t = db.prepare("SELECT id FROM tickets WHERE visit_id = ? AND category = 'mental'").get(visitId);
      if (t) db.prepare('INSERT INTO ticket_updates (ticket_id, user_id, status, note) VALUES (?, ?, ?, ?)').run(t.id, req.user.id, 'open',
        `ส่งต่อ BUU Flood Help (LINE) รหัส ${referral}: รอผู้ประสบภัยส่งรหัสทาง LINE เมื่อเข้าแชทแล้วงานนี้จะปิดเป็น "ส่งต่อ"`);
      markReferred(db, referral); // the villager may have sent the code already
    }

    // Safety check-in uses where the volunteer is, which differs from the house when met elsewhere.
    const here = d.here || (locationSource === 'gps' ? d : null);
    if (here && num(here.lat) != null && num(here.lng) != null) checkin(req.user.id, here.lat, here.lng, here.accuracy);
    db.exec('COMMIT');
    res.json({ id: visitId, level: override || result.level, repairs: [], repair_needs: items.length });
    if (referral) deliver(req.dbx, referral);
    if (locationSource === 'address' && num(d.lat) == null) geocodePending(req.dbx);
  } catch (e) {
    db.exec('ROLLBACK');
    removeFiles(files);
    if (e.status === 400) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'save failed' });
  }
});

app.get('/api/visits', need(), (req, res) => {
  const mine = req.query.mine === '1' || !['admin', 'office'].includes(req.user.role);
  const rows = mine
    ? db.prepare('SELECT * FROM visits WHERE created_by = ? ORDER BY id DESC LIMIT 200').all(req.user.id)
    : db.prepare('SELECT * FROM visits ORDER BY id DESC LIMIT 500').all();
  const queues = db.prepare('SELECT type, seq FROM repair_items WHERE visit_id = ? ORDER BY id');
  const needLabels = (v) => json(v.repair_needs, []).map((n) => (n.type === 'OT' && n.type_other) || REPAIR_TYPES[n.type] || n.type);
  res.json(rows.map((v) => {
    const s = serializeVisit(v, req.user);
    return { id: s.id, created_at: s.created_at, level: s.level, name: `${s.first_name || ''} ${s.last_name || ''}`.trim(),
      address: s.address, needs: s.answers.needs, tickets: ticketSummary(v.id),
      repairs: queues.all(v.id).map((r) => queueNo(r.type, r.seq)), repair_needs: needLabels(v) };
  }));
});

const ticketSummary = (visitId) =>
  db.prepare('SELECT id, category, level, status FROM tickets WHERE visit_id = ? ORDER BY id').all(visitId);

app.get('/api/visits/:id', need(), (req, res) => {
  const v = db.prepare('SELECT * FROM visits WHERE id = ?').get(Number(req.params.id));
  if (!access(req.user, v)) return res.status(404).json({ error: 'not found' });
  const out = serializeVisit(v, req.user);
  out.photos = db.prepare('SELECT id FROM photos WHERE visit_id = ? AND item_uuid IS NULL').all(v.id).map((p) => p.id);
  const itemPhotos = db.prepare('SELECT id FROM photos WHERE visit_id = ? AND item_uuid = ? ORDER BY id');
  out.repair_needs = json(v.repair_needs, []).map((n) => ({ ...n, type_label: REPAIR_TYPES[n.type] || n.type,
    photos: itemPhotos.all(v.id, n.uuid).map((p) => p.id) }));
  out.tickets = db.prepare(`SELECT t.*, u.name AS assignee_name FROM tickets t LEFT JOIN users u ON u.id = t.assignee_id WHERE visit_id = ?`).all(v.id);
  out.repairs = itemsOfVisit(v.id);
  out.creator = db.prepare('SELECT name, email FROM users WHERE id = ?').get(v.created_by);
  if (out.creator) out.creator.phone = decrypt(prodDb.prepare('SELECT phone_enc FROM users WHERE id = ?').get(v.created_by)?.phone_enc);
  out.line_referral = seesMentalDetail(req.user, v) ? referralOfVisit(db, v.id) : null;
  res.json(out);
});

app.get('/api/photos/:id', need(), (req, res) => {
  const p = db.prepare('SELECT p.*, v.created_by FROM photos p JOIN visits v ON v.id = p.visit_id WHERE p.id = ?').get(Number(req.params.id));
  if (!p || !access(req.user, { created_by: p.created_by })) return res.status(404).end();
  res.sendFile(path.join(req.uploadDir, path.basename(p.filename)));
});

mountRepairs(app, { need, upload });
mountLine(app, { need });

// ---------------------------------------------------------------- tickets

function ticketScope(user) {
  if (user.role === 'admin') return { where: '1=1', args: [] };
  if (user.role === 'office') return { where: "(t.category IN ('basic','general') OR t.level = 'red')", args: [] };
  if (user.role === 'responder') {
    // Only the categories of the responder's own specialties, whatever the level.
    const mine = parseSpecialties(user.specialty);
    const cats = Object.entries(CATEGORIES).filter(([, c]) => mine.includes(c.specialty)).map(([k]) => k);
    if (!cats.length) return { where: '0 = 1', args: [] };
    return { where: `t.category IN (${cats.map(() => '?').join(',')})`, args: cats };
  }
  return null;
}

app.get('/api/tickets', need('responder', 'office', 'admin'), (req, res) => {
  const scope = ticketScope(req.user);
  const active = req.query.status !== 'closed';
  const rows = db.prepare(`
    SELECT t.*, v.first_name, v.last_name, v.lat, v.lng, v.address, v.phone_enc, v.line_enc, v.email_enc, v.answers, v.triage, v.location_source,
           u.name AS assignee_name
    FROM tickets t JOIN visits v ON v.id = t.visit_id LEFT JOIN users u ON u.id = t.assignee_id
    WHERE ${scope.where} AND t.status ${active ? "NOT IN ('done','referred')" : "IN ('done','referred')"}
    ORDER BY CASE t.level WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END, t.created_at ASC
    LIMIT 300`).all(...scope.args);
  res.json(rows.map((t) => {
    const answers = json(t.answers, {});
    return {
      id: t.id, visit_id: t.visit_id, category: t.category, level: t.level, status: t.status,
      assignee_id: t.assignee_id, assignee_name: t.assignee_name, created_at: t.created_at, updated_at: t.updated_at,
      name: `${t.first_name || ''} ${t.last_name || ''}`.trim(), phone: decrypt(t.phone_enc), line: decrypt(t.line_enc), email: decrypt(t.email_enc),
      lat: t.lat, lng: t.lng, address: json(t.address, {}), location_source: t.location_source,
      items: (answers.needs || []).filter((n) => NEEDS.find((x) => x.id === n)?.cat === t.category),
      other_need: t.category === 'general' ? answers.other_need : null,
      // Whoever holds a mental-health ticket is caring for that person, so they get the screening result.
      mental: t.category === 'mental' ? mentalSummary(json(t.triage, {}).mental) : null,
    };
  }));
});

const mentalSummary = (m) => (m ? { level: m.level, summary: m.summary, flags: m.flags || [] } : null);

app.get('/api/tickets/count', need('responder', 'office', 'admin'), (req, res) => {
  const scope = ticketScope(req.user);
  const r = db.prepare(`SELECT COUNT(*) AS n, MAX(t.id) AS last FROM tickets t WHERE ${scope.where} AND t.status = 'open'`).get(...scope.args);
  res.json(r);
});

function canTouch(user, t) {
  const scope = ticketScope(user);
  return !!db.prepare(`SELECT 1 FROM tickets t WHERE t.id = ? AND ${scope.where}`).get(t.id, ...scope.args);
}

app.post('/api/tickets/:id/claim', need('responder', 'office', 'admin'), (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(Number(req.params.id));
  if (!t || !canTouch(req.user, t)) return res.status(404).json({ error: 'not found' });
  db.prepare("UPDATE tickets SET assignee_id = ?, status = 'claimed', updated_at = datetime('now') WHERE id = ?").run(req.user.id, t.id);
  db.prepare('INSERT INTO ticket_updates (ticket_id, user_id, status, note) VALUES (?, ?, ?, ?)').run(t.id, req.user.id, 'claimed', null);
  res.json({ ok: true });
});

app.post('/api/tickets/:id/update', need('responder', 'office', 'admin'), (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(Number(req.params.id));
  if (!t || !canTouch(req.user, t)) return res.status(404).json({ error: 'not found' });
  const status = Object.keys(TICKET_STATUS).includes(req.body.status) ? req.body.status : t.status;
  db.prepare("UPDATE tickets SET status = ?, assignee_id = COALESCE(assignee_id, ?), updated_at = datetime('now') WHERE id = ?").run(status, req.user.id, t.id);
  db.prepare('INSERT INTO ticket_updates (ticket_id, user_id, status, note) VALUES (?, ?, ?, ?)').run(t.id, req.user.id, status, str(req.body.note, 1000));
  res.json({ ok: true });
});

app.get('/api/tickets/:id/updates', need('responder', 'office', 'admin'), (req, res) => {
  res.json(db.prepare(`SELECT tu.*, u.name FROM ticket_updates tu JOIN users u ON u.id = tu.user_id WHERE ticket_id = ? ORDER BY tu.id`).all(Number(req.params.id)));
});

// ---------------------------------------------------------------- locations (safety check-ins)

function checkin(uid, lat, lng, accuracy) {
  db.prepare(`INSERT INTO checkins (user_id, lat, lng, accuracy, at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy, at = excluded.at`)
    .run(uid, Number(lat), Number(lng), num(accuracy));
}

app.post('/api/checkin', need(), (req, res) => {
  const { lat, lng, accuracy } = req.body || {};
  if (num(lat) == null || num(lng) == null) return res.status(400).json({ error: 'lat/lng' });
  checkin(req.user.id, lat, lng, accuracy);
  res.json({ ok: true });
});

app.post('/api/checkout', need(), (req, res) => {
  db.prepare('DELETE FROM checkins WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- dashboard

app.get('/api/dashboard', need('responder', 'office', 'admin'), (req, res) => {
  const visits = db.prepare('SELECT id, lat, lng, approx_lat, approx_lng, approx_level, triage_level, override_level, created_at, address, answers, location_source, first_name, last_name FROM visits ORDER BY id DESC LIMIT 2000').all()
    .map((v) => ({
      id: v.id, lat: v.lat, lng: v.lng, created_at: v.created_at, location_source: v.location_source,
      approx_lat: v.approx_lat, approx_lng: v.approx_lng, approx_level: v.approx_level,
      name: `${v.first_name || ''} ${v.last_name || ''}`.trim(),
      level: v.override_level || v.triage_level, address: json(v.address, {}), needs: json(v.answers, {}).needs || [],
      open: db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE visit_id = ? AND status NOT IN ('done','referred')").get(v.id).n,
    }));
  const team = db.prepare(`SELECT c.lat, c.lng, c.accuracy, c.at, u.name, u.role, u.specialty
    FROM checkins c JOIN users u ON u.id = c.user_id WHERE c.at > datetime('now', '-12 hours') ORDER BY c.at DESC`).all();
  const tickets = db.prepare('SELECT category, level, status, COUNT(*) AS n FROM tickets GROUP BY category, level, status').all();
  res.json({ visits, team, tickets });
});

// ---------------------------------------------------------------- users (admin)

app.get('/api/users', need('admin'), (req, res) => {
  const phones = new Map(prodDb.prepare('SELECT id, phone_enc FROM users').all().map((u) => [u.id, decrypt(u.phone_enc)]));
  res.json(db.prepare("SELECT id, email, name, role, specialty, last_login FROM users ORDER BY role != 'pending', role, name").all()
    .map((u) => ({ ...u, phone: phones.get(u.id) || null })));
});

app.patch('/api/users/:id', need('admin'), (req, res) => {
  const { role, specialty } = req.body || {};
  if (!['pending', 'volunteer', 'responder', 'fixer', 'office', 'admin'].includes(role)) return res.status(400).json({ error: 'role' });
  const list = role === 'responder' ? parseSpecialties(specialty).join(',') || null : null;
  db.prepare('UPDATE users SET role = ?, specialty = ? WHERE id = ?').run(role, list, Number(req.params.id));
  res.json({ ok: true });
});

// Upload errors (too big, too many, wrong field) are the client's fault: answer 4xx so the
// phone's outbox marks the visit as rejected instead of retrying it forever.
app.use('/api', (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    for (const f of req.files || []) fs.rm(f.path, () => {});
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: `upload: ${err.code}` });
  }
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

// ---------------------------------------------------------------- static client

const dist = path.resolve(__dirname, '../client/dist');
app.use(express.static(dist, { index: false, maxAge: '1h' }));
app.get('/', (req, res) => {
  const index = path.join(dist, 'index.html');
  if (fs.existsSync(index)) res.set('Cache-Control', 'no-cache').sendFile(index);
  else res.send('Client not built. Run: npm run build');
});

app.listen(PORT, () => console.log(`buuflood listening on :${PORT} (public URL ${PUBLIC_URL})`));

// Approximate map positions for address-only visits: backfill at start, then retry failed lookups every 5 minutes.
const geocodeAll = () => { geocodePending(prodDb); if (sandboxOpen()) geocodePending(sandboxDb()); };
geocodeAll();
setInterval(geocodeAll, 5 * 60 * 1000).unref();
