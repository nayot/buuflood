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

import { db, central, json, withDb, uploadDir, activityDb, sandboxDb, getActivity, ensureUser, resetSandbox, liveActivityIds, isOpenDb } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { geocodePending } from './geocode.js';
import { mountRepairs, itemsError, itemsOfVisit, removeFiles, repairStaff } from './repairs.js';
import { mountIdcard, idcardEnabled } from './idcard.js';
import { mountLine, lineEnabled, LINE_OA, upsertReferral, referralConflict, mentalOf, markReferred, deliver, referralOfVisit } from './line.js';
import { mountActivities, mountActivityAdmin } from './activities.js';
import { parseCode } from '../shared/line.js';
import { triage, ticketsFor, needsMentalScreening, CATEGORIES, LEVELS, TICKET_STATUS, NEEDS, parseSpecialties } from '../shared/triage.js';
import { cleanMental } from '../shared/mental.js';
import { contactError, cleanPhone, cleanLine, cleanEmail, displayName } from '../shared/contact.js';
import { ITEMS_MAX, ITEM_PHOTOS_MAX, REPAIR_TYPES, queueNo } from '../shared/repairs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BASE_PATH = new URL(PUBLIC_URL).pathname.replace(/\/$/, '') || '';
const DOMAINS = (process.env.ALLOWED_DOMAINS || 'go.buu.ac.th,eng.buu.ac.th').split(',').map((s) => s.trim().toLowerCase());
// New accounts from these domains start as `pending` and can do nothing until an admin gives them a role
// (e.g. gmail.com, which anyone can have). `*` = any other Google account, with approval.
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

// ---------------------------------------------------------------- account of this request

// The signed-in Google account (central database). Activity routes add the activity, the member's role in it and the
// database to use (see `activityContext` below).
app.use((req, res, next) => {
  const uid = req.session?.uid;
  req.account = uid ? central.prepare('SELECT * FROM users WHERE id = ?').get(uid) : null;
  next();
});

// ---------------------------------------------------------------- app on/off (admin switch)

// While the app is closed, every API call except /api/me answers 503 for non-admins. 503, not 4xx: the phone's outbox
// keeps queued visits and sends them once the app is open again. The LINE webhook (outside /api) keeps working.
const appClosed = () => {
  const v = central.prepare("SELECT value FROM settings WHERE key = 'app_closed'").get()?.value;
  return v ? JSON.parse(v) : null;
};
app.use('/api', (req, res, next) => {
  if (req.path === '/me' || req.path.startsWith('/announcements/') || req.account?.role === 'admin') return next();
  const closed = appClosed();
  if (closed) return res.status(503).json({ error: 'closed', message: closed.message || null });
  next();
});

// ---------------------------------------------------------------- auth

const domainOf = (email) => String(email).toLowerCase().split('@')[1];
const needsApproval = (email) => APPROVAL_DOMAINS.includes(domainOf(email))
  || (APPROVAL_DOMAINS.includes('*') && !DOMAINS.includes(domainOf(email)));
const allowedEmail = (email) => DOMAINS.includes(domainOf(email)) || needsApproval(email);

// Accounts are `user`, `admin` or `pending` (waiting for approval). What a user may do comes from their role in each
// activity (memberships).
function upsertUser({ email, name, picture }) {
  email = email.toLowerCase();
  const existing = central.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) {
    const role = ADMINS.includes(email) ? 'admin' : existing.role;
    central.prepare("UPDATE users SET name = ?, picture = ?, role = ?, last_login = datetime('now') WHERE id = ?")
      .run(name || existing.name, picture || existing.picture, role, existing.id);
    return existing.id;
  }
  const role = ADMINS.includes(email) ? 'admin' : needsApproval(email) ? 'pending' : 'user';
  return Number(central.prepare("INSERT INTO users (email, name, picture, role, last_login) VALUES (?, ?, ?, ?, datetime('now'))")
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
  // Local testing only: /auth/dev?email=someone@eng.buu.ac.th[&admin=1][&activity=2&role=responder&specialty=electrical]
  app.get('/auth/dev', (req, res) => {
    const email = String(req.query.email || 'dev@eng.buu.ac.th');
    if (!allowedEmail(email)) return res.status(403).send('domain not allowed');
    const uid = upsertUser({ email, name: email.split('@')[0] });
    if (req.query.admin === '1') central.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(uid);
    if (req.query.activity && req.query.role) {
      central.prepare(`INSERT INTO memberships (activity_id, user_id, role, specialty) VALUES (?, ?, ?, ?)
        ON CONFLICT DO UPDATE SET role = excluded.role, specialty = excluded.specialty`)
        .run(Number(req.query.activity), uid, String(req.query.role), parseSpecialties(req.query.specialty).join(',') || null);
    }
    req.session = { uid };
    res.redirect(`${PUBLIC_URL}/#/`);
  });
  console.log('DEV_AUTH enabled: /auth/dev?email=...');
}

app.post('/auth/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

// Roles inside an activity. Admins act as `admin` in every activity; managers lead their own.
const LEAD = ['admin', 'manager'];
const isLead = (user) => LEAD.includes(user.role);

const need = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'login' });
  if (req.account.role === 'pending') return res.status(403).json({ error: 'pending' });
  if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
  next();
};
/** The activity must have this module switched on. */
const mod = (name) => (req, res, next) => (req.modules.includes(name) ? next() : res.status(403).json({ error: 'module' }));

app.get('/api/me', (req, res) => {
  if (!req.account) return res.json({ user: null, devAuth: DEV_AUTH, domains: DOMAINS, approval: APPROVAL_DOMAINS });
  const { id, email, name, picture, role } = req.account;
  const admin = role === 'admin';
  // Members see their activities; admins see every live one (archived ones are on the activities page).
  const activities = central.prepare(`SELECT a.id, a.name, a.area, a.starts_on, a.ends_on, a.modules, a.status, m.role
    FROM activities a LEFT JOIN memberships m ON m.activity_id = a.id AND m.user_id = ?
    WHERE ${admin ? "(a.status = 'live' OR m.user_id IS NOT NULL)" : "m.user_id IS NOT NULL AND (a.status = 'live' OR m.role = 'manager')"}
    ORDER BY a.status = 'archived', a.starts_on DESC, a.id DESC`).all(id).map((a) => ({ ...a, modules: json(a.modules, []) }));
  res.json({ user: { id, email, name, picture, realRole: role, phone: decrypt(req.account.phone_enc),
    pending_users: admin ? central.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'pending'").get().n : 0 },
    activities, emergency: EMERGENCY, closed: appClosed() });
});

// The volunteer's own phone (account data, not activity data).
// Pending accounts may add theirs too, so the admin can check who is asking.
app.post('/api/me/phone', (req, res) => {
  if (!req.account) return res.status(401).json({ error: 'login' });
  const phone = cleanPhone(req.body?.phone);
  if (phone.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'เบอร์โทรศัพท์ไม่ครบ' });
  central.prepare('UPDATE users SET phone_enc = ? WHERE id = ?').run(encrypt(phone), req.account.id);
  res.json({ ok: true, phone });
});

// ---------------------------------------------------------------- app on/off, announcements (whole app)

const realAdmin = (req, res, next) => (req.account?.role === 'admin' ? next() : res.status(403).json({ error: 'forbidden' }));

app.post('/api/app-closed', realAdmin, (req, res) => {
  if (req.body?.closed) {
    const value = JSON.stringify({ message: String(req.body.message || '').trim().slice(0, 300) || null,
      since: new Date().toISOString(), by: req.account.name || req.account.email });
    central.prepare("INSERT INTO settings (key, value) VALUES ('app_closed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value);
  } else central.prepare("DELETE FROM settings WHERE key = 'app_closed'").run();
  res.json({ ok: true, closed: appClosed() });
});

// Every signed-in account gets them, including pending ones and while the app is closed (the /api gate lets
// /api/announcements/* through); the phone polls `pending` and acknowledges each one.
const announcementsFor = (uid) => central.prepare(`SELECT a.id, a.message, a.created_at, u.name AS by FROM announcements a
  LEFT JOIN users u ON u.id = a.created_by
  WHERE a.ended_at IS NULL AND NOT EXISTS (SELECT 1 FROM announcement_acks k WHERE k.announcement_id = a.id AND k.user_id = ?)
  ORDER BY a.id`).all(uid);

app.get('/api/announcements/pending', (req, res) => {
  if (!req.account) return res.status(401).json({ error: 'login' });
  res.json(announcementsFor(req.account.id));
});

app.post('/api/announcements/:id/ack', (req, res) => {
  if (!req.account) return res.status(401).json({ error: 'login' });
  central.prepare('INSERT OR IGNORE INTO announcement_acks (announcement_id, user_id) SELECT id, ? FROM announcements WHERE id = ?')
    .run(req.account.id, Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/announcements', realAdmin, (req, res) => {
  const users = central.prepare("SELECT COUNT(*) AS n FROM users WHERE role != 'pending'").get().n;
  res.json({ users, list: central.prepare(`SELECT a.*, u.name AS by,
      (SELECT COUNT(*) FROM announcement_acks k JOIN users x ON x.id = k.user_id
        WHERE k.announcement_id = a.id AND x.role != 'pending') AS acks
    FROM announcements a LEFT JOIN users u ON u.id = a.created_by ORDER BY a.id DESC LIMIT 50`).all() });
});

app.post('/api/announcements', realAdmin, (req, res) => {
  const message = String(req.body?.message || '').trim().slice(0, 1000);
  if (!message) return res.status(400).json({ error: 'message' });
  const id = Number(central.prepare('INSERT INTO announcements (message, created_by) VALUES (?, ?)').run(message, req.account.id).lastInsertRowid);
  central.prepare('INSERT INTO announcement_acks (announcement_id, user_id) VALUES (?, ?)').run(id, req.account.id); // the sender has read it
  res.json({ ok: true, id });
});

app.post('/api/announcements/:id/end', realAdmin, (req, res) => {
  central.prepare("UPDATE announcements SET ended_at = datetime('now') WHERE id = ? AND ended_at IS NULL").run(Number(req.params.id));
  res.json({ ok: true });
});

// Activities, accounts and join links (central): server/activities.js
mountActivities(app, { realAdmin });

// ---------------------------------------------------------------- activity context

// Everything about one activity is under /api/a/<id>/…: the id is in the URL, so photo and CSV links carry it too.
// Admins enter any activity as `admin`; members with their role there. Admin test mode (8 h, also for managers of the
// activity) sends everything to the activity's sandbox; the session holds { aid, until, role, specialty }.
const TEST_HOURS = 8;
const ar = express.Router({ mergeParams: true });

function activityContext(req, res, next) {
  if (!req.account) return res.status(401).json({ error: 'login' });
  if (req.account.role === 'pending') return res.status(403).json({ error: 'pending' });
  const activity = getActivity(req.params.aid);
  if (!activity) return res.status(404).json({ error: 'activity' });
  const admin = req.account.role === 'admin';
  const m = central.prepare('SELECT role, specialty FROM memberships WHERE activity_id = ? AND user_id = ?').get(activity.id, req.account.id);
  if (!admin && (!m || m.role === 'pending')) return res.status(403).json({ error: m ? 'pending' : 'member' });
  const archived = activity.status === 'archived';
  // Archived activities are for admins and the activity's managers only.
  if (archived && !admin && m.role !== 'manager') return res.status(403).json({ error: 'archived' });
  const t = req.session.test;
  req.canTest = !archived && (admin || m?.role === 'manager');
  req.test = req.canTest && t?.aid === activity.id && t.until > Date.now();
  if (t && !req.test && (t.until <= Date.now() || t.aid === activity.id)) req.session.test = null;
  req.activity = activity;
  req.modules = json(activity.modules, []);
  req.archived = archived;
  req.dbx = req.test ? sandboxDb(activity.id) : activityDb(activity.id);
  const role = req.test ? t.role || 'admin' : admin ? 'admin' : m.role;
  const specialty = req.test ? t.specialty || null : admin ? null : m.specialty;
  withDb(req.dbx, () => {
    req.uploadDir = uploadDir();
    ensureUser(req.dbx, req.account, role);
    req.user = { ...req.account, role, specialty, repairStaff: repairStaff(role, req.modules) };
    if (req.method !== 'GET') {
      // The client says which mode it thinks it is in; a change it has not seen yet (e.g. test mode expired) must not
      // send its next action to the other database. Archived: 409 too, so phones keep anything still queued.
      const expect = req.get('X-Test-Mode');
      if (expect != null && (expect === '1') !== req.test) return res.status(409).json({ error: 'mode', test: req.test });
      if (archived && !req.path.startsWith('/admin/')) return res.status(409).json({ error: 'archived' });
    }
    next();
  });
}
app.use('/api/a/:aid', activityContext, ar);

ar.get('/me', (req, res) => {
  const a = req.activity;
  res.json({ activity: { id: a.id, name: a.name, area: a.area, starts_on: a.starts_on, ends_on: a.ends_on, status: a.status,
    modules: req.modules, deidentified_at: a.deidentified_at },
    role: req.user.role, specialty: req.user.specialty, specialties: parseSpecialties(req.user.specialty),
    repair_staff: req.user.repairStaff, can_test: req.canTest,
    test: req.test ? { until: req.session.test.until } : null,
    pending_members: isLead(req.user) ? central.prepare("SELECT COUNT(*) AS n FROM memberships WHERE activity_id = ? AND role = 'pending'").get(a.id).n : 0,
    line_oa: lineEnabled && req.modules.includes('visits') ? LINE_OA : null,
    idcard: idcardEnabled && req.modules.includes('repairs') && req.user.repairStaff });
});

// ---------------------------------------------------------------- admin test mode (per activity)

const tester = (req, res, next) => (req.canTest ? next() : res.status(403).json({ error: 'forbidden' }));

ar.post('/test-mode', tester, (req, res) => {
  req.session.test = req.body?.on ? { aid: req.activity.id, until: Date.now() + TEST_HOURS * 3600 * 1000, role: null, specialty: null } : null;
  res.json({ ok: true });
});

// Test as another role: only inside the sandbox. Leaving test mode always works.
ar.post('/test-mode/role', tester, (req, res) => {
  if (!req.test) return res.status(409).json({ error: 'mode', test: false });
  const { role, specialty } = req.body || {};
  if (!['volunteer', 'responder', 'fixer', 'office', 'manager', 'admin'].includes(role)) return res.status(400).json({ error: 'role' });
  req.session.test = { ...req.session.test, role, specialty: role === 'responder' ? parseSpecialties(specialty).join(',') || null : null };
  res.json({ ok: true });
});

ar.post('/test-mode/reset', tester, (req, res) => {
  resetSandbox(req.activity.id);
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
  if (isLead(user) || user.role === 'office' || visit.created_by === user.id) return 'full';
  if (user.role === 'responder') return 'responder';
  return null;
}

// The 2Q/9Q/8Q answers are health data: only admins, the volunteer who asked them and mental-health responders
// see them. Everyone else who can open the visit sees the level and the 9Q/8Q totals.
const seesMentalDetail = (user, visit) => isLead(user) || visit.created_by === user.id
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
    first_name: v.first_name, last_name: v.last_name, nickname: v.nickname,
    phone: decrypt(v.phone_enc), line: decrypt(v.line_enc), email: decrypt(v.email_enc), no_contact: !!v.no_contact,
    address: json(v.address, {}), answers, triage_level: v.triage_level, triage: tri,
    override_level: v.override_level, override_reason: v.override_reason, notes: v.notes,
    level: v.override_level || v.triage_level,
    location_source: v.location_source || 'gps',
  };
}

ar.post('/visits', need(), mod('visits'), upload, (req, res) => {
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
    if (referralConflict(code, { activityId: req.activity.id, userId: req.user.id })) return fail('code taken');
    referral = code;
  }

  const a = d.address || {};
  const address = Object.fromEntries(['house_no', 'village', 'floor', 'moo', 'soi', 'road', 'tambon', 'amphoe', 'province'].map((k) => [k, str(a[k], 100)]));
  const name = `${str(d.first_name, 100)} ${str(d.last_name, 100)}`;

  db.exec('BEGIN');
  try {
    const visitId = Number(db.prepare(`INSERT INTO visits
      (uuid, created_by, visited_at, lat, lng, accuracy, first_name, last_name, nickname, phone_enc, line_enc, email_enc, no_contact,
       address, answers, triage_level, triage, override_level, override_reason, notes, location_source, repair_needs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      String(d.uuid), req.user.id, str(d.visited_at, 40), num(d.lat), num(d.lng), num(d.accuracy),
      str(d.first_name, 100), str(d.last_name, 100), str(d.nickname, 50),
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
      const t = db.prepare("SELECT id FROM tickets WHERE visit_id = ? AND category = 'mental'").get(visitId);
      if (t) db.prepare('INSERT INTO ticket_updates (ticket_id, user_id, status, note) VALUES (?, ?, ?, ?)').run(t.id, req.user.id, 'open',
        `ส่งต่อ BUU Flood Help (LINE) รหัส ${referral}: รอผู้ประสบภัยส่งรหัสทาง LINE เมื่อเข้าแชทแล้วงานนี้จะปิดเป็น "ส่งต่อ"`);
    }

    // Safety check-in uses where the volunteer is, which differs from the house when met elsewhere.
    const here = d.here || (locationSource === 'gps' ? d : null);
    if (here && num(here.lat) != null && num(here.lng) != null) checkin(req.user.id, here.lat, here.lng, here.accuracy);
    db.exec('COMMIT');
    if (referral) {
      // Central database (the webhook finds it there); checked for conflicts before the transaction.
      upsertReferral({ code: referral, activityId: req.activity.id, test: req.test, user: req.user, visitId,
        visitUuid: String(d.uuid), person: { ...d, address }, mental: mentalOf(result.mental) });
      markReferred(referral); // the villager may have sent the code already
    }
    res.json({ id: visitId, level: override || result.level, repairs: [], repair_needs: items.length });
    if (referral) deliver(referral);
    if (locationSource === 'address' && num(d.lat) == null) geocodePending(req.dbx);
  } catch (e) {
    db.exec('ROLLBACK');
    removeFiles(files);
    if (e.status === 400) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'save failed' });
  }
});

ar.get('/visits', need(), mod('visits'), (req, res) => {
  const mine = req.query.mine === '1' || !['office', ...LEAD].includes(req.user.role);
  const rows = mine
    ? db.prepare('SELECT * FROM visits WHERE created_by = ? ORDER BY id DESC LIMIT 200').all(req.user.id)
    : db.prepare('SELECT * FROM visits ORDER BY id DESC LIMIT 500').all();
  const queues = db.prepare('SELECT type, seq FROM repair_items WHERE visit_id = ? ORDER BY id');
  const needLabels = (v) => json(v.repair_needs, []).map((n) => (n.type === 'OT' && n.type_other) || REPAIR_TYPES[n.type] || n.type);
  res.json(rows.map((v) => {
    const s = serializeVisit(v, req.user);
    return { id: s.id, created_at: s.created_at, level: s.level, name: displayName(s),
      address: s.address, needs: s.answers.needs, tickets: ticketSummary(v.id),
      repairs: queues.all(v.id).map((r) => queueNo(r.type, r.seq)), repair_needs: needLabels(v) };
  }));
});

const ticketSummary = (visitId) =>
  db.prepare('SELECT id, category, level, status FROM tickets WHERE visit_id = ? ORDER BY id').all(visitId);

ar.get('/visits/:id', need(), (req, res) => {
  const v = db.prepare('SELECT * FROM visits WHERE id = ?').get(Number(req.params.id));
  if (!access(req.user, v)) return res.status(404).json({ error: 'not found' });
  const out = serializeVisit(v, req.user);
  out.photos = db.prepare('SELECT id FROM photos WHERE visit_id = ? AND item_uuid IS NULL').all(v.id).map((p) => p.id);
  const itemPhotos = db.prepare('SELECT id FROM photos WHERE visit_id = ? AND item_uuid = ? ORDER BY id');
  out.repair_needs = json(v.repair_needs, []).map((n) => ({ ...n, type_label: REPAIR_TYPES[n.type] || n.type,
    photos: itemPhotos.all(v.id, n.uuid).map((p) => p.id) }));
  out.tickets = db.prepare(`SELECT t.*, u.name AS assignee_name FROM tickets t LEFT JOIN users u ON u.id = t.assignee_id WHERE visit_id = ?`).all(v.id);
  out.repairs = itemsOfVisit(v.id);
  out.creator = db.prepare('SELECT name, email, phone_enc FROM users WHERE id = ?').get(v.created_by);
  if (out.creator) {
    // The account's current phone; for an account that no longer exists (e.g. volunteers of a 2.x archive), the one
    // kept in the activity's own copy.
    const { phone_enc: kept, ...c } = out.creator;
    out.creator = { ...c, phone: decrypt(central.prepare('SELECT phone_enc FROM users WHERE id = ?').get(v.created_by)?.phone_enc ?? kept) };
  }
  out.line_referral = seesMentalDetail(req.user, v) ? referralOfVisit(req.activity.id, req.test, v.id) : null;
  res.json(out);
});

ar.get('/photos/:id', need(), (req, res) => {
  const p = db.prepare('SELECT p.*, v.created_by FROM photos p JOIN visits v ON v.id = p.visit_id WHERE p.id = ?').get(Number(req.params.id));
  if (!p || !access(req.user, { created_by: p.created_by })) return res.status(404).end();
  res.sendFile(path.join(req.uploadDir, path.basename(p.filename)));
});

mountIdcard(ar, { need, mod });
mountRepairs(ar, { need, upload, mod });
mountLine(app, ar, { need, mod });
mountActivityAdmin(ar, { need, LEAD });

// ---------------------------------------------------------------- tickets

function ticketScope(user) {
  if (isLead(user)) return { where: '1=1', args: [] };
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

ar.get('/tickets', need('responder', 'office', ...LEAD), mod('visits'), (req, res) => {
  const scope = ticketScope(req.user);
  const active = req.query.status !== 'closed';
  const rows = db.prepare(`
    SELECT t.*, v.first_name, v.last_name, v.nickname, v.lat, v.lng, v.address, v.phone_enc, v.line_enc, v.email_enc, v.answers, v.triage, v.location_source,
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
      name: displayName(t), phone: decrypt(t.phone_enc), line: decrypt(t.line_enc), email: decrypt(t.email_enc),
      lat: t.lat, lng: t.lng, address: json(t.address, {}), location_source: t.location_source,
      items: (answers.needs || []).filter((n) => NEEDS.find((x) => x.id === n)?.cat === t.category),
      other_need: t.category === 'general' ? answers.other_need : null,
      // Whoever holds a mental-health ticket is caring for that person, so they get the screening result.
      mental: t.category === 'mental' ? mentalSummary(json(t.triage, {}).mental) : null,
    };
  }));
});

const mentalSummary = (m) => (m ? { level: m.level, summary: m.summary, flags: m.flags || [] } : null);

ar.get('/tickets/count', need('responder', 'office', ...LEAD), mod('visits'), (req, res) => {
  const scope = ticketScope(req.user);
  const r = db.prepare(`SELECT COUNT(*) AS n, MAX(t.id) AS last FROM tickets t WHERE ${scope.where} AND t.status = 'open'`).get(...scope.args);
  res.json(r);
});

function canTouch(user, t) {
  const scope = ticketScope(user);
  return !!db.prepare(`SELECT 1 FROM tickets t WHERE t.id = ? AND ${scope.where}`).get(t.id, ...scope.args);
}

ar.post('/tickets/:id/claim', need('responder', 'office', ...LEAD), mod('visits'), (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(Number(req.params.id));
  if (!t || !canTouch(req.user, t)) return res.status(404).json({ error: 'not found' });
  db.prepare("UPDATE tickets SET assignee_id = ?, status = 'claimed', updated_at = datetime('now') WHERE id = ?").run(req.user.id, t.id);
  db.prepare('INSERT INTO ticket_updates (ticket_id, user_id, status, note) VALUES (?, ?, ?, ?)').run(t.id, req.user.id, 'claimed', null);
  res.json({ ok: true });
});

ar.post('/tickets/:id/update', need('responder', 'office', ...LEAD), mod('visits'), (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(Number(req.params.id));
  if (!t || !canTouch(req.user, t)) return res.status(404).json({ error: 'not found' });
  const status = Object.keys(TICKET_STATUS).includes(req.body.status) ? req.body.status : t.status;
  db.prepare("UPDATE tickets SET status = ?, assignee_id = COALESCE(assignee_id, ?), updated_at = datetime('now') WHERE id = ?").run(status, req.user.id, t.id);
  db.prepare('INSERT INTO ticket_updates (ticket_id, user_id, status, note) VALUES (?, ?, ?, ?)').run(t.id, req.user.id, status, str(req.body.note, 1000));
  res.json({ ok: true });
});

ar.get('/tickets/:id/updates', need('responder', 'office', ...LEAD), mod('visits'), (req, res) => {
  res.json(db.prepare(`SELECT tu.*, u.name FROM ticket_updates tu JOIN users u ON u.id = tu.user_id WHERE ticket_id = ? ORDER BY tu.id`).all(Number(req.params.id)));
});

// ---------------------------------------------------------------- locations (safety check-ins)

function checkin(uid, lat, lng, accuracy) {
  db.prepare(`INSERT INTO checkins (user_id, lat, lng, accuracy, at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy, at = excluded.at`)
    .run(uid, Number(lat), Number(lng), num(accuracy));
}

ar.post('/checkin', need(), (req, res) => {
  const { lat, lng, accuracy } = req.body || {};
  if (num(lat) == null || num(lng) == null) return res.status(400).json({ error: 'lat/lng' });
  checkin(req.user.id, lat, lng, accuracy);
  res.json({ ok: true });
});

ar.post('/checkout', need(), (req, res) => {
  db.prepare('DELETE FROM checkins WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- dashboard

ar.get('/dashboard', need('responder', 'office', ...LEAD), mod('visits'), (req, res) => {
  const visits = db.prepare('SELECT id, lat, lng, approx_lat, approx_lng, approx_level, triage_level, override_level, created_at, address, answers, location_source, first_name, last_name, nickname FROM visits ORDER BY id DESC LIMIT 2000').all()
    .map((v) => ({
      id: v.id, lat: v.lat, lng: v.lng, created_at: v.created_at, location_source: v.location_source,
      approx_lat: v.approx_lat, approx_lng: v.approx_lng, approx_level: v.approx_level,
      name: displayName(v),
      level: v.override_level || v.triage_level, address: json(v.address, {}), needs: json(v.answers, {}).needs || [],
      open: db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE visit_id = ? AND status NOT IN ('done','referred')").get(v.id).n,
    }));
  const team = db.prepare(`SELECT c.lat, c.lng, c.accuracy, c.at, u.name, u.role, u.specialty
    FROM checkins c JOIN users u ON u.id = c.user_id WHERE c.at > datetime('now', '-12 hours') ORDER BY c.at DESC`).all();
  const tickets = db.prepare('SELECT category, level, status, COUNT(*) AS n FROM tickets GROUP BY category, level, status').all();
  res.json({ visits, team, tickets });
});

ar.use((req, res) => res.status(404).json({ error: 'not found' }));

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
const geocodeAll = () => {
  for (const id of liveActivityIds()) {
    geocodePending(activityDb(id));
    if (isOpenDb(`${id}:sandbox`)) geocodePending(sandboxDb(id));
  }
};
geocodeAll();
setInterval(geocodeAll, 5 * 60 * 1000).unref();
