// SQLite storage (Node's built-in node:sqlite). One file under DATA_DIR.
//
// Two databases with the same schema: production (DATA_DIR/buuflood.db, photos in DATA_DIR/uploads) and the admin
// test mode sandbox (DATA_DIR/sandbox/). Request code imports `db`, which points at the database chosen for the
// current request (see `withDb` and the middleware in server.js). Outside a request `db` throws instead of
// falling back to production, so a test-mode write can never land in the real data by accident. Background jobs
// and scripts use `prodDb` (or `withDb`) explicitly.
import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const SANDBOX_DIR = path.join(DATA_DIR, 'sandbox');

function openDb(dir) {
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  const d = new DatabaseSync(path.join(dir, 'buuflood.db'));
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(d);
  return d;
}

function migrate(d) {
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
  if (!hasColumn('users', 'phone_enc')) {
    // v2.6: the volunteer's own phone (encrypted), so the team and responders can reach them. Read from prodDb only.
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
    area TEXT,                                    -- JSON: moo, village, tambon, amphoe, province
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

  // Mental-health referrals to the BUU Flood Help LINE OA (server/line.js). A row can exist before its visit (registered
  // from the form, or the villager sent the code first); visit_id is filled in when the visit is uploaded.
  d.exec(`
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

export const prodDb = openDb(DATA_DIR);
const uploadDirs = new WeakMap([[prodDb, UPLOAD_DIR]]);

// The sandbox is opened on first use and deleted by resetSandbox(). Its users are copied from production with the
// same ids, so the session's user id and the foreign keys still work.
let sandbox = null;
export function sandboxDb() {
  if (!sandbox) {
    sandbox = openDb(SANDBOX_DIR);
    uploadDirs.set(sandbox, path.join(SANDBOX_DIR, 'uploads'));
    syncSandboxUsers();
  }
  return sandbox;
}
export const sandboxOpen = () => !!sandbox;

/** Copy the production accounts into the sandbox. Roles changed inside the sandbox are kept unless `all`. */
export function syncSandboxUsers({ all = false } = {}) {
  const s = sandboxDb();
  const cols = 'id, email, name, picture, role, specialty, created_at, last_login';
  const ins = s.prepare(`INSERT INTO users (${cols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture
    ${all ? ', role = excluded.role, specialty = excluded.specialty' : ''}`);
  for (const u of prodDb.prepare(`SELECT ${cols} FROM users`).all()) {
    ins.run(u.id, u.email, u.name, u.picture, u.role, u.specialty, u.created_at, u.last_login);
  }
}

/** Delete every test record and photo. The next test-mode request starts a fresh sandbox. */
export function resetSandbox() {
  if (sandbox) { sandbox.close(); sandbox = null; }
  fs.rmSync(SANDBOX_DIR, { recursive: true, force: true });
}

const current = new AsyncLocalStorage();
/** Run `fn` with `db` pointing at `d` (prodDb or sandboxDb()). */
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
export const isSandbox = () => current.getStore() === sandbox && !!sandbox;

export const json = (s, fallback = null) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};
