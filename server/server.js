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

import { db, json, UPLOAD_DIR } from './db.js';
import { encrypt, decrypt, maskId, makePrintToken, readPrintToken } from './crypto.js';
import { renderForm, renderExpired } from './print.js';
import { triage, ticketsFor, CATEGORIES, LEVELS, TICKET_STATUS, NEEDS } from '../shared/triage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BASE_PATH = new URL(PUBLIC_URL).pathname.replace(/\/$/, '') || '';
const DOMAINS = (process.env.ALLOWED_DOMAINS || 'go.buu.ac.th,eng.buu.ac.th').split(',').map((s) => s.trim().toLowerCase());
const ADMINS = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const DEV_AUTH = !PROD && process.env.DEV_AUTH === '1';
const FORM_YEAR = process.env.FORM_YEAR || String(new Date().getFullYear() + 543);

for (const k of ['SESSION_SECRET', 'DATA_KEY']) {
  if (!process.env[k]) { console.error(`Missing ${k} in .env — see .env.example`); process.exit(1); }
}

const oauth = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${PUBLIC_URL}/auth/callback`);

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(cookieSession({
  name: 'buuflood',
  secret: process.env.SESSION_SECRET,
  path: `${BASE_PATH}/`,
  httpOnly: true,
  sameSite: 'lax',
  secure: PUBLIC_URL.startsWith('https://'),
  maxAge: 14 * 86400 * 1000,
}));

// ---------------------------------------------------------------- auth

const allowedEmail = (email) => DOMAINS.includes(String(email).toLowerCase().split('@')[1]);

function upsertUser({ email, name, picture }) {
  email = email.toLowerCase();
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) {
    const role = ADMINS.includes(email) ? 'admin' : existing.role;
    db.prepare("UPDATE users SET name = ?, picture = ?, role = ?, last_login = datetime('now') WHERE id = ?")
      .run(name || existing.name, picture || existing.picture, role, existing.id);
    return existing.id;
  }
  const role = ADMINS.includes(email) ? 'admin' : 'volunteer';
  return Number(db.prepare("INSERT INTO users (email, name, picture, role, last_login) VALUES (?, ?, ?, ?, datetime('now'))")
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
  // Local testing only: /auth/dev?email=someone@eng.buu.ac.th&role=responder&specialty=electrical
  app.get('/auth/dev', (req, res) => {
    const email = String(req.query.email || 'dev@eng.buu.ac.th');
    if (!allowedEmail(email)) return res.status(403).send('domain not allowed');
    const uid = upsertUser({ email, name: email.split('@')[0] });
    if (req.query.role) db.prepare('UPDATE users SET role = ?, specialty = ? WHERE id = ?').run(String(req.query.role), req.query.specialty ? String(req.query.specialty) : null, uid);
    req.session = { uid };
    res.redirect(`${PUBLIC_URL}/#/`);
  });
  console.log('DEV_AUTH enabled: /auth/dev?email=...');
}

app.post('/auth/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

function loadUser(req, res, next) {
  const uid = req.session?.uid;
  req.user = uid ? db.prepare('SELECT * FROM users WHERE id = ?').get(uid) : null;
  next();
}
app.use(loadUser);

const need = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'login' });
  if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
  next();
};

app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null, devAuth: DEV_AUTH });
  const { id, email, name, picture, role, specialty } = req.user;
  res.json({ user: { id, email, name, picture, role, specialty } });
});

// ---------------------------------------------------------------- visits

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || '.jpg').toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const str = (v, max = 200) => (v == null || v === '' ? null : String(v).slice(0, max));
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const digits = (v, n) => { const d = String(v || '').replace(/\D/g, ''); return d ? d.slice(0, n) : null; };

// Who may see a visit, and how much of it.
function access(user, visit) {
  if (!user || !visit) return null;
  if (user.role === 'admin' || user.role === 'office' || visit.created_by === user.id) return 'full';
  if (user.role === 'responder') return 'responder';
  return null;
}

function serializeVisit(v, level) {
  const out = {
    id: v.id, uuid: v.uuid, created_at: v.created_at, visited_at: v.visited_at, created_by: v.created_by,
    lat: v.lat, lng: v.lng, accuracy: v.accuracy, consent: !!v.consent,
    title: v.title, first_name: v.first_name, last_name: v.last_name, age: v.age,
    residence_type: v.residence_type, residence_other: v.residence_other, address: json(v.address, {}),
    flood_from: v.flood_from, flood_to: v.flood_to, relief_case: v.relief_case, damage_desc: v.damage_desc,
    promptpay: v.promptpay, evidence: json(v.evidence, []), answers: json(v.answers, {}),
    triage_level: v.triage_level, triage: json(v.triage, {}),
    override_level: v.override_level, override_reason: v.override_reason, notes: v.notes,
    level: v.override_level || v.triage_level,
    location_source: v.location_source || 'gps',
  };
  const id = decrypt(v.national_id_enc);
  out.phone = decrypt(v.phone_enc);
  out.national_id = level === 'full' ? id : maskId(id);
  return out;
}

app.post('/api/visits', need(), upload.array('photos', 10), (req, res) => {
  let d;
  try { d = JSON.parse(req.body.data || '{}'); } catch { return res.status(400).json({ error: 'bad data' }); }
  if (!d.uuid) return res.status(400).json({ error: 'uuid required' });

  const dup = db.prepare('SELECT id FROM visits WHERE uuid = ?').get(String(d.uuid));
  if (dup) {
    for (const f of req.files || []) fs.rm(f.path, () => {});
    return res.json({ id: dup.id, duplicate: true });
  }

  const answers = {
    needs: Array.isArray(d.answers?.needs) ? d.answers.needs.filter((n) => NEEDS.some((x) => x.id === n)) : [],
    cannot_travel: !!d.answers?.cannot_travel,
    other_need: str(d.answers?.other_need, 500),
  };
  const result = triage(answers);
  if (!str(d.first_name) || !str(d.last_name)) return res.status(400).json({ error: 'name required' });
  const locationSource = d.location_source === 'address' ? 'address' : 'gps';
  const a0 = d.address || {};
  if (locationSource === 'address' && !(str(a0.tambon) && str(a0.amphoe) && str(a0.province) && (str(a0.house_no) || str(a0.moo)))) {
    return res.status(400).json({ error: 'address required' });
  }
  const override = LEVELS.includes(d.override_level) ? d.override_level : null;
  if (override && !str(d.override_reason)) return res.status(400).json({ error: 'override reason required' });
  const consent = d.consent ? 1 : 0;

  const a = d.address || {};
  const address = Object.fromEntries(['house_no', 'village', 'floor', 'moo', 'soi', 'road', 'tambon', 'amphoe', 'province'].map((k) => [k, str(a[k], 100)]));

  db.exec('BEGIN');
  try {
    const visitId = Number(db.prepare(`INSERT INTO visits
      (uuid, created_by, visited_at, lat, lng, accuracy, consent, title, first_name, last_name, age,
       national_id_enc, phone_enc, residence_type, residence_other, address, flood_from, flood_to,
       relief_case, damage_desc, promptpay, evidence, answers, triage_level, triage, override_level, override_reason, notes,
       location_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      String(d.uuid), req.user.id, str(d.visited_at, 40), num(d.lat), num(d.lng), num(d.accuracy), consent,
      str(d.title, 30), str(d.first_name, 100), str(d.last_name, 100), num(d.age),
      // Personal identifiers are stored only with consent.
      consent ? encrypt(digits(d.national_id, 13)) : null, consent ? encrypt(digits(d.phone, 15)) : null,
      str(d.residence_type, 20), str(d.residence_other, 100), JSON.stringify(address),
      str(d.flood_from, 10), str(d.flood_to, 10), num(d.relief_case), str(d.damage_desc, 500),
      ['yes', 'no'].includes(d.promptpay) ? d.promptpay : null, JSON.stringify(Array.isArray(d.evidence) ? d.evidence : []),
      JSON.stringify(answers), result.level, JSON.stringify(result), override, str(d.override_reason, 500), str(d.notes, 1000),
      locationSource,
    ).lastInsertRowid);

    const insT = db.prepare('INSERT INTO tickets (visit_id, category, level) VALUES (?, ?, ?)');
    for (const t of ticketsFor(result, override)) insT.run(visitId, t.category, t.level);
    const insP = db.prepare('INSERT INTO photos (visit_id, filename) VALUES (?, ?)');
    for (const f of req.files || []) insP.run(visitId, f.filename);

    // Safety check-in uses where the volunteer is, which differs from the house when met elsewhere.
    const here = d.here || (locationSource === 'gps' ? d : null);
    if (here && num(here.lat) != null && num(here.lng) != null) checkin(req.user.id, here.lat, here.lng, here.accuracy);
    db.exec('COMMIT');
    res.json({ id: visitId, level: override || result.level });
  } catch (e) {
    db.exec('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'save failed' });
  }
});

app.get('/api/visits', need(), (req, res) => {
  const mine = req.query.mine === '1' || !['admin', 'office'].includes(req.user.role);
  const rows = mine
    ? db.prepare('SELECT * FROM visits WHERE created_by = ? ORDER BY id DESC LIMIT 200').all(req.user.id)
    : db.prepare('SELECT * FROM visits ORDER BY id DESC LIMIT 500').all();
  res.json(rows.map((v) => {
    const s = serializeVisit(v, access(req.user, v));
    return { id: s.id, created_at: s.created_at, level: s.level, name: `${s.first_name || ''} ${s.last_name || ''}`.trim(),
      address: s.address, needs: s.answers.needs, tickets: ticketSummary(v.id) };
  }));
});

const ticketSummary = (visitId) =>
  db.prepare('SELECT id, category, level, status FROM tickets WHERE visit_id = ? ORDER BY id').all(visitId);

app.get('/api/visits/:id', need(), (req, res) => {
  const v = db.prepare('SELECT * FROM visits WHERE id = ?').get(Number(req.params.id));
  const lvl = access(req.user, v);
  if (!lvl) return res.status(404).json({ error: 'not found' });
  const out = serializeVisit(v, lvl);
  out.photos = db.prepare('SELECT id FROM photos WHERE visit_id = ?').all(v.id).map((p) => p.id);
  out.tickets = db.prepare(`SELECT t.*, u.name AS assignee_name FROM tickets t LEFT JOIN users u ON u.id = t.assignee_id WHERE visit_id = ?`).all(v.id);
  out.creator = db.prepare('SELECT name, email FROM users WHERE id = ?').get(v.created_by);
  out.can_print = lvl === 'full';
  res.json(out);
});

app.get('/api/photos/:id', need(), (req, res) => {
  const p = db.prepare('SELECT p.*, v.created_by FROM photos p JOIN visits v ON v.id = p.visit_id WHERE p.id = ?').get(Number(req.params.id));
  if (!p || !access(req.user, { created_by: p.created_by })) return res.status(404).end();
  res.sendFile(path.join(UPLOAD_DIR, path.basename(p.filename)));
});

// ---------------------------------------------------------------- print links (no login)

app.post('/api/visits/:id/print-link', need(), (req, res) => {
  const v = db.prepare('SELECT * FROM visits WHERE id = ?').get(Number(req.params.id));
  if (access(req.user, v) !== 'full') return res.status(404).json({ error: 'not found' });
  if (!v.consent) return res.status(400).json({ error: 'no consent' });
  const { token, expires } = makePrintToken(v.id);
  res.json({ url: `${PUBLIC_URL}/print/${token}`, expires });
});

app.get('/print/:token', (req, res) => {
  const id = readPrintToken(req.params.token);
  const v = id && db.prepare('SELECT * FROM visits WHERE id = ?').get(id);
  res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex');
  if (!v) return res.status(410).send(renderExpired());
  const data = serializeVisit(v, 'full');
  data.photos = db.prepare('SELECT id FROM photos WHERE visit_id = ?').all(v.id);
  res.send(renderForm(data, { year: FORM_YEAR, photoUrl: (pid) => `${req.params.token}/photo/${pid}` }));
});

app.get('/print/:token/photo/:pid', (req, res) => {
  const id = readPrintToken(req.params.token);
  const p = id && db.prepare('SELECT * FROM photos WHERE id = ? AND visit_id = ?').get(Number(req.params.pid), id);
  if (!p) return res.status(404).end();
  res.sendFile(path.join(UPLOAD_DIR, path.basename(p.filename)));
});

// ---------------------------------------------------------------- tickets

function ticketScope(user) {
  if (user.role === 'admin') return { where: '1=1', args: [] };
  if (user.role === 'office') return { where: "(t.category IN ('basic','general') OR t.level = 'red')", args: [] };
  if (user.role === 'responder') {
    const cats = Object.entries(CATEGORIES).filter(([, c]) => c.specialty === user.specialty || c.specialty === 'any').map(([k]) => k);
    return { where: `(t.category IN (${cats.map(() => '?').join(',') || "''"}) OR t.level = 'red')`, args: cats };
  }
  return null;
}

app.get('/api/tickets', need('responder', 'office', 'admin'), (req, res) => {
  const scope = ticketScope(req.user);
  const active = req.query.status !== 'closed';
  const rows = db.prepare(`
    SELECT t.*, v.first_name, v.last_name, v.lat, v.lng, v.address, v.phone_enc, v.answers, v.location_source,
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
      name: `${t.first_name || ''} ${t.last_name || ''}`.trim(), phone: decrypt(t.phone_enc),
      lat: t.lat, lng: t.lng, address: json(t.address, {}), location_source: t.location_source,
      items: (answers.needs || []).filter((n) => NEEDS.find((x) => x.id === n)?.cat === t.category),
      other_need: t.category === 'general' ? answers.other_need : null,
    };
  }));
});

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
  const visits = db.prepare('SELECT id, lat, lng, triage_level, override_level, created_at, address, answers, location_source, first_name, last_name FROM visits ORDER BY id DESC LIMIT 2000').all()
    .map((v) => ({
      id: v.id, lat: v.lat, lng: v.lng, created_at: v.created_at, location_source: v.location_source,
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
  res.json(db.prepare('SELECT id, email, name, role, specialty, last_login FROM users ORDER BY role, name').all());
});

app.patch('/api/users/:id', need('admin'), (req, res) => {
  const { role, specialty } = req.body || {};
  if (!['volunteer', 'responder', 'office', 'admin'].includes(role)) return res.status(400).json({ error: 'role' });
  db.prepare('UPDATE users SET role = ?, specialty = ? WHERE id = ?').run(role, role === 'responder' ? str(specialty, 20) : null, Number(req.params.id));
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
