// SQLite storage (Node's built-in node:sqlite). One file under DATA_DIR.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'buuflood.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  picture TEXT,
  role TEXT NOT NULL DEFAULT 'volunteer',      -- volunteer | responder | office | admin
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
const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasColumn('visits', 'location_source')) {
  // gps = phone position at the house; address = met elsewhere, located by address (optionally a map pin)
  db.exec("ALTER TABLE visits ADD COLUMN location_source TEXT NOT NULL DEFAULT 'gps'");
}

export const json = (s, fallback = null) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};
