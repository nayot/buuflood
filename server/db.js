// SQLite storage (Node's built-in node:sqlite).
//
// 3.0: one central database plus one database per activity (กิจกรรม).
//   DATA_DIR/central.db                      accounts, activities, memberships, settings, announcements, LINE referrals
//   DATA_DIR/activities/<id>/buuflood.db     the activity's visits, tickets, repair items, check-ins (+ uploads/)
//   DATA_DIR/activities/<id>/sandbox/        the activity's admin test mode (same schema)
// Request code imports `db`, which points at the database of the current request's activity (see `withDb` and the
// activity middleware in server.js). Outside a request `db` throws rather than guessing, so a write can never land in
// another activity or outside the sandbox by accident. Background jobs and scripts open a database explicitly.
// Archived activities are opened read-only.
import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const ACTIVITIES_DIR = path.join(DATA_DIR, 'activities');
export const activityDir = (id) => path.join(ACTIVITIES_DIR, String(Number(id)));

const readOnlyDbs = new WeakSet();
export const isReadOnly = (d) => readOnlyDbs.has(d);

function openActivityFile(dir, { readOnly = false } = {}) {
  if (!readOnly) fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  const file = path.join(dir, 'buuflood.db');
  if (readOnly) { const r = new DatabaseSync(file, { readOnly: true }); readOnlyDbs.add(r); return r; }
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrateActivity(d);
  return d;
}

function migrateActivity(d) {
  d.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    picture TEXT,
    role TEXT NOT NULL DEFAULT 'volunteer',      -- volunteer | responder | fixer | office | admin
    specialty TEXT,                               -- responders: comma-separated electrical,structural,physical,mental
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY,
    uuid TEXT UNIQUE NOT NULL,                    -- generated on the phone, so an offline retry never duplicates
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    visited_at TEXT,
    lat REAL, lng REAL, accuracy REAL,
    consent INTEGER NOT NULL DEFAULT 0,
    title TEXT, first_name TEXT, last_name TEXT, age INTEGER,
    national_id_enc TEXT,                         -- AES-256-GCM, see crypto.js
    phone_enc TEXT,
    residence_type TEXT, residence_other TEXT,
    address TEXT,                                 -- JSON: house_no, village, floor, moo, soi, road, tambon, amphoe, province
    flood_from TEXT, flood_to TEXT,
    relief_case INTEGER, damage_desc TEXT,
    promptpay TEXT,                               -- yes | no
    evidence TEXT,                                -- JSON array of EVIDENCE keys
    answers TEXT NOT NULL,                        -- JSON: { needs: [], cannot_travel, other_need }
    triage_level TEXT, triage TEXT,               -- computed level + JSON detail
    override_level TEXT, override_reason TEXT,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY,
    visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY,
    visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    level TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    assignee_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_updates (
    id INTEGER PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT, note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS checkins (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    lat REAL NOT NULL, lng REAL NOT NULL, accuracy REAL,
    at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
  CREATE INDEX IF NOT EXISTS idx_visits_creator ON visits(created_by);
  `);

  // Migrations: add columns to existing databases.
  const hasColumn = (table, col) => d.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!hasColumn('visits', 'location_source')) {
    // gps = phone position at the house; address = met elsewhere, located by address (optionally a map pin)
    d.exec("ALTER TABLE visits ADD COLUMN location_source TEXT NOT NULL DEFAULT 'gps'");
  }
  if (!hasColumn('visits', 'approx_lat')) {
    // Approximate position looked up from the address (address mode without a pin). Never used for navigation.
    // approx_level: village | tambon | amphoe | none (not found); geocoded_at is set after every finished lookup.
    d.exec('ALTER TABLE visits ADD COLUMN approx_lat REAL');
    d.exec('ALTER TABLE visits ADD COLUMN approx_lng REAL');
    d.exec('ALTER TABLE visits ADD COLUMN approx_level TEXT');
    d.exec('ALTER TABLE visits ADD COLUMN geocoded_at TEXT');
  }

  if (!hasColumn('visits', 'line_enc')) {
    // v2: contact by phone, LINE or email (any one), all encrypted. The v1 relief-form columns (title, age,
    // national_id_enc, residence_*, flood_*, relief_case, damage_desc, promptpay, evidence, consent) are kept but unused.
    d.exec('ALTER TABLE visits ADD COLUMN line_enc TEXT');
    d.exec('ALTER TABLE visits ADD COLUMN email_enc TEXT');
    d.exec('ALTER TABLE visits ADD COLUMN no_contact INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn('visits', 'nickname')) {
    // v2.7.2: the villager's nickname (ชื่อเล่น), optional; villages often know people by it.
    d.exec('ALTER TABLE visits ADD COLUMN nickname TEXT');
  }
  if (!hasColumn('users', 'phone_enc')) {
    // v2.6: the volunteer's own phone. Since 3.0 it lives in central.db; this column stays empty in activity files.
    d.exec('ALTER TABLE users ADD COLUMN phone_enc TEXT');
  }
  if (!hasColumn('visits', 'repair_needs')) {
    // v2.3: items listed during a home visit are a survey of needs, not Fixing Centre registrations (no queue number;
    // the owner registers at the centre). JSON array of { uuid, type, type_other, brand, problem }; their photos are
    // rows in `photos` with item_uuid set. Visits from 2.0-2.2 may still have rows in repair_items.
    d.exec('ALTER TABLE visits ADD COLUMN repair_needs TEXT');
    d.exec('ALTER TABLE photos ADD COLUMN item_uuid TEXT');
  }

  // Fixing Centre. Items are registered at the centre (visit_id null). Up to 2.2 home visits also created items
  // (visit_id set, status 'registered'); since 2.3 those are visits.repair_needs. The owner's name and contacts are
  // copied onto the item, so the report needs no join.
  d.exec(`
  CREATE TABLE IF NOT EXISTS repair_items (
    id INTEGER PRIMARY KEY,
    uuid TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,                           -- REPAIR_TYPES key (MC, FR, ...)
    seq INTEGER NOT NULL,                         -- running number within the type: queue no. = type-seq
    visit_id INTEGER REFERENCES visits(id) ON DELETE CASCADE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    owner_name TEXT NOT NULL,
    phone_enc TEXT, line_enc TEXT, email_enc TEXT,
    area TEXT,                                    -- JSON: house_no, moo, village, tambon, amphoe, province
    type_other TEXT, brand TEXT, problem TEXT,
    status TEXT NOT NULL DEFAULT 'registered',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (type, seq)
  );

  CREATE TABLE IF NOT EXISTS repair_photos (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES repair_items(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS repair_updates (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES repair_items(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT, note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_repair_visit ON repair_items(visit_id);
  `);
  if (!hasColumn('repair_items', 'owner_code')) {
    // 3.2: one item per ID card. A keyed one-way code of the owner's ID number (crypto.idCode); the number is never stored.
    d.exec('ALTER TABLE repair_items ADD COLUMN owner_code TEXT');
  }
  d.exec('CREATE INDEX IF NOT EXISTS idx_repair_owner ON repair_items(owner_code)');

  // Mental-health referrals to the BUU Flood Help LINE OA (server/line.js). A row can exist before its visit (registered
  // from the form, or the villager sent the code first); visit_id is filled in when the visit is uploaded.
  d.exec(`
  CREATE TABLE IF NOT EXISTS settings (           -- app-wide switches; only the production database's copy is read
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS announcements (      -- admin messages that pop up until each user acknowledges them
    id INTEGER PRIMARY KEY,
    message TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT                                 -- withdrawn: no longer shown
  );

  CREATE TABLE IF NOT EXISTS announcement_acks (
    announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    acked_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (announcement_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS line_referrals (
    code TEXT PRIMARY KEY,                        -- BF-XXXXX (BT- in test mode)
    created_by INTEGER REFERENCES users(id),
    visit_id INTEGER REFERENCES visits(id) ON DELETE CASCADE,
    visit_uuid TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    first_name TEXT, last_name TEXT, phone_enc TEXT, line_enc TEXT,
    area TEXT,                                    -- JSON: house_no, moo, village, tambon, amphoe, province
    mental TEXT,                                  -- JSON: level, summary, q9, q8
    line_user_enc TEXT,                           -- the villager's LINE user id, encrypted
    status TEXT NOT NULL DEFAULT 'waiting',       -- waiting | linked | sent | failed
    error TEXT, linked_at TEXT, sent_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_line_visit ON line_referrals(visit_id);
  `);
}


function migrateCentral(d) {
  d.exec(`
  CREATE TABLE IF NOT EXISTS users (                -- Google accounts
    id INTEGER PRIMARY KEY AUTOINCREMENT,           -- never reused: activity databases keep rows of deleted accounts
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    picture TEXT,
    role TEXT NOT NULL DEFAULT 'user',              -- user | admin | pending (waiting for approval)
    phone_enc TEXT,                                 -- the volunteer's own phone, encrypted
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    area TEXT,                                      -- free text, e.g. ต.โขมง อ.ท่าใหม่ จ.จันทบุรี
    starts_on TEXT, ends_on TEXT,                   -- YYYY-MM-DD, optional
    modules TEXT NOT NULL,                          -- JSON array: visits (home visits, jobs, map) | repairs (Fixing Centre)
    status TEXT NOT NULL DEFAULT 'live',            -- live | archived
    join_token TEXT UNIQUE,
    join_open INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at TEXT,
    deidentified_at TEXT                            -- personal data removed from the archive
  );

  CREATE TABLE IF NOT EXISTS memberships (
    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'volunteer',         -- manager | volunteer | responder | fixer | office | pending
    specialty TEXT,                                 -- responders: comma-separated electrical,structural,physical,mental
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (activity_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS settings (             -- app-wide switches
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS announcements (        -- admin messages that pop up until each user acknowledges them
    id INTEGER PRIMARY KEY,
    message TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
  );

  CREATE TABLE IF NOT EXISTS announcement_acks (
    announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    acked_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (announcement_id, user_id)
  );

  -- Mental-health referrals to the BUU Flood Help LINE OA (server/line.js). Central, because the webhook has no session
  -- and must find the activity from the code alone. activity_id is null until the volunteer's phone registers the code
  -- (the villager may send it first). visit_id is the visit's id inside that activity's database (or its sandbox: test).
  CREATE TABLE IF NOT EXISTS line_referrals (
    code TEXT PRIMARY KEY,                          -- BF-XXXXX (BT- in test mode)
    activity_id INTEGER REFERENCES activities(id),
    test INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,                             -- account id (no foreign key: accounts may be deleted)
    volunteer TEXT,                                 -- the volunteer's name, for the brief
    visit_id INTEGER,
    visit_uuid TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    first_name TEXT, last_name TEXT, phone_enc TEXT, line_enc TEXT,
    area TEXT,                                      -- JSON: house_no, moo, village, tambon, amphoe, province
    mental TEXT,                                    -- JSON: level, summary, q9, q8
    line_user_enc TEXT,                             -- the villager's LINE user id, encrypted
    status TEXT NOT NULL DEFAULT 'waiting',         -- waiting | linked | sent | failed
    error TEXT, linked_at TEXT, sent_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_line_visit ON line_referrals(activity_id, test, visit_id);
  `);
}

// ---------------------------------------------------------------- 2.x → 3.0

// Up to 2.7 there was one database, DATA_DIR/buuflood.db (+ uploads/, sandbox/). On the first start of 3.0 it becomes
// activity 1, archived, with every record kept; only the admin accounts are carried over to the central database
// (the archive keeps its own copy of every account, so names on visits and tickets still show). Back up DATA_DIR first.
const LEGACY_NAME = process.env.LEGACY_ACTIVITY_NAME || 'ลงพื้นที่โขมง 10 ต.ค.';

function migrateLegacy(central) {
  const old = path.join(DATA_DIR, 'buuflood.db');
  if (!fs.existsSync(old) || central.prepare('SELECT COUNT(*) AS n FROM activities').get().n) return;
  console.log(`3.0 migration: archiving ${old} as activity 1 "${LEGACY_NAME}"`);
  const legacy = new DatabaseSync(old);
  legacy.exec('PRAGMA foreign_keys = ON;');
  migrateActivity(legacy); // bring an older 2.x file up to the last 2.x schema first
  const users = legacy.prepare('SELECT * FROM users').all();
  const refs = legacy.prepare('SELECT r.*, u.name AS volunteer FROM line_referrals r LEFT JOIN users u ON u.id = r.created_by').all();
  const closed = legacy.prepare("SELECT value FROM settings WHERE key = 'app_closed'").get();
  const span = legacy.prepare("SELECT MIN(date(created_at, '+7 hours')) AS a, MAX(date(created_at, '+7 hours')) AS b FROM visits").get();
  const repairs = legacy.prepare('SELECT COUNT(*) AS n FROM repair_items WHERE visit_id IS NULL').get().n;
  legacy.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;');
  legacy.close();

  const dir = activityDir(1);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['buuflood.db', 'buuflood.db-wal', 'buuflood.db-shm', 'uploads']) {
    if (fs.existsSync(path.join(DATA_DIR, f))) fs.renameSync(path.join(DATA_DIR, f), path.join(dir, f));
  }
  fs.rmSync(path.join(DATA_DIR, 'sandbox'), { recursive: true, force: true }); // 2.x test data

  central.exec('BEGIN');
  try {
    const maxId = users.reduce((m, u) => Math.max(m, u.id), 0);
    const insU = central.prepare(`INSERT INTO users (id, email, name, picture, role, phone_enc, created_at, last_login)
      VALUES (?, ?, ?, ?, 'admin', ?, ?, ?)`);
    for (const u of users.filter((x) => x.role === 'admin')) insU.run(u.id, u.email, u.name, u.picture, u.phone_enc, u.created_at, u.last_login);
    // New accounts get ids above every old one, so an id in the archive always means the same person.
    if (!central.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'users'").run(BigInt(maxId)).changes) {
      central.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('users', ?)").run(BigInt(maxId));
    }
    central.prepare(`INSERT INTO activities (id, name, area, starts_on, ends_on, modules, status, join_open, archived_at)
      VALUES (1, ?, ?, ?, ?, ?, 'archived', 0, datetime('now'))`).run(LEGACY_NAME, 'ต.โขมง อ.ท่าใหม่ จ.จันทบุรี',
      span.a, span.b, JSON.stringify(repairs ? ['visits', 'repairs'] : ['visits']));
    const cols = ['code', 'created_by', 'visit_id', 'visit_uuid', 'created_at', 'updated_at', 'first_name', 'last_name',
      'phone_enc', 'line_enc', 'area', 'mental', 'line_user_enc', 'status', 'error', 'linked_at', 'sent_at', 'volunteer'];
    const insR = central.prepare(`INSERT INTO line_referrals (activity_id, test, ${cols.join(', ')})
      VALUES (1, 0, ${cols.map(() => '?').join(', ')})`);
    for (const r of refs) insR.run(...cols.map((c) => r[c] ?? null));
    if (closed) central.prepare("INSERT INTO settings (key, value) VALUES ('app_closed', ?)").run(closed.value);
    central.exec('COMMIT');
  } catch (e) {
    central.exec('ROLLBACK');
    throw e;
  }
  console.log(`3.0 migration: kept ${users.filter((x) => x.role === 'admin').length} admin(s) of ${users.length} accounts, ${refs.length} LINE referral(s)`);
}

export const central = new DatabaseSync(path.join((fs.mkdirSync(DATA_DIR, { recursive: true }), DATA_DIR), 'central.db'));
central.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
migrateCentral(central);
migrateLegacy(central);

// ---------------------------------------------------------------- activity databases

const uploadDirs = new WeakMap();
const opened = new Map(); // `${id}` or `${id}:sandbox` -> DatabaseSync

export const getActivity = (id) => central.prepare('SELECT * FROM activities WHERE id = ?').get(Number(id));

/** The activity's database (read-only when archived). Opened on first use and kept open. */
export function activityDb(id) {
  const key = String(Number(id));
  let d = opened.get(key);
  if (d?.isOpen) return d;
  const a = getActivity(id);
  if (!a) throw new Error(`no activity ${id}`);
  d = openActivityFile(activityDir(a.id), { readOnly: a.status === 'archived' });
  opened.set(key, d);
  uploadDirs.set(d, path.join(activityDir(a.id), 'uploads'));
  return d;
}

/** The activity's test-mode sandbox. */
export function sandboxDb(id) {
  const key = `${Number(id)}:sandbox`;
  let d = opened.get(key);
  if (d?.isOpen) return d;
  const dir = path.join(activityDir(id), 'sandbox');
  d = openActivityFile(dir);
  opened.set(key, d);
  uploadDirs.set(d, path.join(dir, 'uploads'));
  return d;
}

/** Close the activity's databases, e.g. before archiving (they reopen in the right mode on next use). */
export function closeActivity(id, { sandbox = true } = {}) {
  for (const key of [String(Number(id)), ...(sandbox ? [`${Number(id)}:sandbox`] : [])]) {
    const d = opened.get(key);
    if (d?.isOpen) {
      if (!readOnlyDbs.has(d)) d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      d.close();
    }
    opened.delete(key);
  }
}

/** Delete the activity's test records and photos (and its test LINE referrals). */
export function resetSandbox(id) {
  closeActivity(id, { sandbox: true });
  activityDb(id); // keep the real one open
  fs.rmSync(path.join(activityDir(id), 'sandbox'), { recursive: true, force: true });
  central.prepare('DELETE FROM line_referrals WHERE activity_id = ? AND test = 1').run(Number(id));
}

/** Open the activity's file for writing even when archived (archiving, de-identifying). Close it when done. */
export function openForMaintenance(id) {
  closeActivity(id, { sandbox: false });
  const d = new DatabaseSync(path.join(activityDir(id), 'buuflood.db'));
  d.exec('PRAGMA foreign_keys = ON;');
  return d;
}

/** Create the folder and database of a new activity. */
export function createActivityFiles(id) {
  const d = openActivityFile(activityDir(id));
  d.close();
}

/** Copy (or refresh) an account into an activity database, so names show on visits and tickets there. */
export function ensureUser(d, u, role) {
  if (readOnlyDbs.has(d)) return;
  const row = d.prepare('SELECT email, name, picture, role FROM users WHERE id = ?').get(u.id);
  if (row && row.email === u.email && row.name === u.name && row.picture === u.picture && row.role === role) return;
  d.prepare(`INSERT INTO users (id, email, name, picture, role) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture, role = excluded.role`)
    .run(u.id, u.email, u.name, u.picture, role);
}

/** Live activity ids (for background jobs such as geocoding). */
export const liveActivityIds = () => central.prepare("SELECT id FROM activities WHERE status = 'live'").all().map((a) => a.id);
export const isOpenDb = (key) => opened.get(key)?.isOpen;

const current = new AsyncLocalStorage();
/** Run `fn` with `db` pointing at `d` (an activity database or its sandbox). */
export const withDb = (d, fn) => current.run(d, fn);
const active = () => {
  const d = current.getStore();
  if (!d) throw new Error('db used outside withDb()');
  return d;
};
export const db = new Proxy({}, {
  get(_, prop) {
    const d = active();
    const v = d[prop];
    return typeof v === 'function' ? v.bind(d) : v;
  },
});
/** Upload directory of the current request's database. */
export const uploadDir = () => uploadDirs.get(active());

export const json = (s, fallback = null) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};
