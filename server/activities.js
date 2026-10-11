// Activities (กิจกรรม), accounts, memberships and join links (central database), and each activity's lead pages:
// members, summary, CSV exports and a SQLite snapshot for analysis.
//
// An activity is created by an admin with a set of modules (visits = home visits, jobs and map; repairs = Fixing
// Centre). Volunteers join by the activity's link or QR code; its managers and the admins give them roles. When the
// work is handed over, an admin archives the activity: its database becomes read-only and stays available for analysis.
// Personal data can then be removed from the archive (de-identify) once follow-up is finished.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { central, db, json, getActivity, activityDir, closeActivity, openForMaintenance, createActivityFiles,
  activityDb, DATA_DIR } from './db.js';
import { decrypt } from './crypto.js';
import { NEEDS, CATEGORIES, TICKET_STATUS, SPECIALTIES, parseSpecialties } from '../shared/triage.js';
import { REPAIR_TYPES, REPAIR_STATUS, queueNo } from '../shared/repairs.js';
import { MODULES, ACTIVITY_ROLES } from '../shared/activities.js';

const str = (v, max = 200) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const token = () => crypto.randomBytes(9).toString('base64url');
const cleanModules = (m) => (Array.isArray(m) ? Object.keys(MODULES).filter((k) => m.includes(k)) : []);

const activityOut = (a) => ({ ...a, modules: json(a.modules, []), join_token: undefined });

export function mountActivities(app, { realAdmin }) {
  const signedIn = (req, res, next) => (req.account ? next() : res.status(401).json({ error: 'login' }));

  // ------------------------------------------------------------ activities (admins)

  app.get('/api/activities', realAdmin, (req, res) => {
    const rows = central.prepare(`SELECT a.*, (SELECT COUNT(*) FROM memberships m WHERE m.activity_id = a.id AND m.role != 'pending') AS members,
        (SELECT COUNT(*) FROM memberships m WHERE m.activity_id = a.id AND m.role = 'pending') AS pending,
        (SELECT group_concat(u.name, ', ') FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.activity_id = a.id AND m.role = 'manager') AS managers
      FROM activities a ORDER BY a.status = 'archived', COALESCE(a.starts_on, a.created_at) DESC, a.id DESC`).all();
    res.json(rows.map((a) => {
      let visits = null; let repairs = null;
      try {
        const d = activityDb(a.id);
        visits = d.prepare('SELECT COUNT(*) AS n FROM visits').get().n;
        repairs = d.prepare('SELECT COUNT(*) AS n FROM repair_items WHERE visit_id IS NULL').get().n;
      } catch { /* missing file */ }
      return { ...activityOut(a), visits, repairs, folder: `activities/${a.id}` };
    }));
  });

  const activityFields = (b) => ({
    name: str(b.name, 120), area: str(b.area, 200), starts_on: day(b.starts_on), ends_on: day(b.ends_on), modules: cleanModules(b.modules),
  });

  app.post('/api/activities', realAdmin, (req, res) => {
    const f = activityFields(req.body || {});
    if (!f.name) return res.status(400).json({ error: 'name' });
    if (!f.modules.length) return res.status(400).json({ error: 'modules' });
    const id = Number(central.prepare(`INSERT INTO activities (name, area, starts_on, ends_on, modules, join_token, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(f.name, f.area, f.starts_on, f.ends_on, JSON.stringify(f.modules), token(), req.account.id).lastInsertRowid);
    createActivityFiles(id);
    res.json({ ok: true, id });
  });

  app.patch('/api/activities/:id', realAdmin, (req, res) => {
    const a = getActivity(req.params.id);
    if (!a) return res.status(404).json({ error: 'not found' });
    const f = activityFields({ ...activityOut(a), ...req.body });
    if (!f.name || !f.modules.length) return res.status(400).json({ error: !f.name ? 'name' : 'modules' });
    central.prepare('UPDATE activities SET name = ?, area = ?, starts_on = ?, ends_on = ?, modules = ? WHERE id = ?')
      .run(f.name, f.area, f.starts_on, f.ends_on, JSON.stringify(f.modules), a.id);
    res.json({ ok: true });
  });

  // Archive: read-only from now on, join link off, test data deleted. Reopening makes it live again.
  app.post('/api/activities/:id/archive', realAdmin, (req, res) => {
    const a = getActivity(req.params.id);
    if (!a) return res.status(404).json({ error: 'not found' });
    const archive = req.body?.archived !== false;
    if (archive && a.status !== 'archived') {
      const d = openForMaintenance(a.id); // closes the open connections (and checkpoints the WAL)
      d.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;');
      d.close();
      closeActivity(a.id);
      fs.rmSync(path.join(activityDir(a.id), 'sandbox'), { recursive: true, force: true });
      central.prepare('DELETE FROM line_referrals WHERE activity_id = ? AND test = 1').run(a.id);
      central.prepare("UPDATE activities SET status = 'archived', archived_at = datetime('now'), join_open = 0 WHERE id = ?").run(a.id);
      if (req.session.test?.aid === a.id) req.session.test = null;
    } else if (!archive && a.status === 'archived') {
      closeActivity(a.id);
      central.prepare("UPDATE activities SET status = 'live', archived_at = NULL WHERE id = ?").run(a.id);
      activityDb(a.id); // reopen for writing (WAL again)
    }
    res.json({ ok: true });
  });

  // Remove personal data from an archived activity, keeping what the statistics need. Cannot be undone.
  app.post('/api/activities/:id/deidentify', realAdmin, (req, res) => {
    const a = getActivity(req.params.id);
    if (!a) return res.status(404).json({ error: 'not found' });
    if (a.status !== 'archived') return res.status(409).json({ error: 'archive first' });
    if (req.body?.confirm !== a.name) return res.status(400).json({ error: 'confirm' });
    const d = openForMaintenance(a.id);
    const files = [];
    try {
      d.exec('BEGIN');
      files.push(...d.prepare('SELECT filename FROM photos').all(), ...d.prepare('SELECT filename FROM repair_photos').all());
      const visits = d.prepare('SELECT id, address, answers FROM visits').all();
      const upd = d.prepare(`UPDATE visits SET first_name = NULL, last_name = NULL, nickname = NULL, title = NULL, age = NULL,
        national_id_enc = NULL, phone_enc = NULL, line_enc = NULL, email_enc = NULL, lat = NULL, lng = NULL, accuracy = NULL,
        notes = NULL, override_reason = NULL, damage_desc = NULL, promptpay = NULL, evidence = NULL, address = ?, answers = ? WHERE id = ?`);
      for (const v of visits) {
        const ad = json(v.address, {});
        const ans = json(v.answers, {});
        delete ans.mental; // the 2Q/9Q/8Q answers; the level and totals stay in `triage`
        delete ans.other_need;
        upd.run(JSON.stringify({ moo: ad.moo || null, tambon: ad.tambon || null, amphoe: ad.amphoe || null, province: ad.province || null }),
          JSON.stringify(ans), v.id);
      }
      d.exec(`UPDATE ticket_updates SET note = NULL;
        UPDATE repair_items SET owner_name = '-', phone_enc = NULL, line_enc = NULL, email_enc = NULL, brand = NULL,
          area = json_object('tambon', json_extract(area, '$.tambon'), 'amphoe', json_extract(area, '$.amphoe'), 'province', json_extract(area, '$.province'));
        UPDATE repair_updates SET note = NULL;
        DELETE FROM photos; DELETE FROM repair_photos; DELETE FROM checkins;
        UPDATE line_referrals SET first_name = NULL, last_name = NULL, phone_enc = NULL, line_enc = NULL, line_user_enc = NULL, area = NULL;
        UPDATE users SET name = 'ผู้ใช้ #' || id, email = 'user' || id || '@removed', picture = NULL, phone_enc = NULL;`);
      d.exec('COMMIT');
      d.exec('VACUUM');
    } catch (e) {
      try { d.exec('ROLLBACK'); } catch { /* not in a transaction */ }
      d.close();
      console.error('deidentify:', e.message);
      return res.status(500).json({ error: 'failed' });
    }
    d.close();
    for (const f of files) fs.rmSync(path.join(activityDir(a.id), 'uploads', path.basename(f.filename)), { force: true });
    central.prepare(`UPDATE line_referrals SET first_name = NULL, last_name = NULL, phone_enc = NULL, line_enc = NULL,
      line_user_enc = NULL, area = NULL, volunteer = NULL WHERE activity_id = ?`).run(a.id);
    central.prepare("UPDATE activities SET deidentified_at = datetime('now') WHERE id = ?").run(a.id);
    res.json({ ok: true, photos: files.length });
  });

  // ------------------------------------------------------------ accounts (admins)

  app.get('/api/users', realAdmin, (req, res) => {
    const mem = central.prepare(`SELECT m.user_id, m.role, a.id, a.name, a.status FROM memberships m JOIN activities a ON a.id = m.activity_id
      ORDER BY a.status = 'archived', a.id DESC`).all();
    res.json(central.prepare("SELECT id, email, name, role, phone_enc, last_login FROM users ORDER BY role != 'pending', role != 'admin', name").all()
      .map(({ phone_enc, ...u }) => ({ ...u, phone: decrypt(phone_enc),
        activities: mem.filter((m) => m.user_id === u.id).map((m) => ({ id: m.id, name: m.name, role: m.role, status: m.status })) })));
  });

  app.patch('/api/users/:id', realAdmin, (req, res) => {
    const role = req.body?.role;
    if (!['user', 'admin', 'pending'].includes(role)) return res.status(400).json({ error: 'role' });
    if (Number(req.params.id) === req.account.id) return res.status(400).json({ error: 'self' });
    central.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, Number(req.params.id));
    res.json({ ok: true });
  });

  // Delete an account (memberships and acknowledgements go with it; activity databases keep their copy for history).
  app.delete('/api/users/:id', realAdmin, (req, res) => {
    if (Number(req.params.id) === req.account.id) return res.status(400).json({ error: 'self' });
    central.prepare('UPDATE announcements SET created_by = NULL WHERE created_by = ?').run(Number(req.params.id));
    central.prepare('DELETE FROM users WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ join link (any signed-in account)

  const joinable = (t) => central.prepare("SELECT * FROM activities WHERE join_token = ? AND status = 'live' AND join_open = 1").get(String(t));

  app.get('/api/join/:token', signedIn, (req, res) => {
    const a = joinable(req.params.token);
    if (!a) return res.status(404).json({ error: 'closed' });
    const m = central.prepare('SELECT role FROM memberships WHERE activity_id = ? AND user_id = ?').get(a.id, req.account.id);
    res.json({ id: a.id, name: a.name, area: a.area, starts_on: a.starts_on, ends_on: a.ends_on, role: m?.role || null });
  });

  // New members are volunteers. Accounts still waiting for approval (e.g. @gmail.com) join as `pending`: the
  // activity's managers approve them on the members page, which also approves the account.
  app.post('/api/join/:token', signedIn, (req, res) => {
    const a = joinable(req.params.token);
    if (!a) return res.status(404).json({ error: 'closed' });
    const role = req.account.role === 'pending' ? 'pending' : 'volunteer';
    central.prepare('INSERT OR IGNORE INTO memberships (activity_id, user_id, role) VALUES (?, ?, ?)').run(a.id, req.account.id, role);
    res.json({ ok: true, id: a.id });
  });
}

// ---------------------------------------------------------------- inside an activity (managers and admins)

export function mountActivityAdmin(ar, { need, LEAD }) {
  const lead = need(...LEAD);

  ar.get('/admin/members', lead, (req, res) => {
    res.json(central.prepare(`SELECT u.id, u.email, u.name, u.role AS account, u.phone_enc, u.last_login, m.role, m.specialty, m.joined_at
      FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.activity_id = ?
      ORDER BY m.role != 'pending', m.role != 'manager', u.name`).all(req.activity.id)
      .map(({ phone_enc, ...u }) => ({ ...u, phone: decrypt(phone_enc) })));
  });

  ar.patch('/admin/members/:uid', lead, (req, res) => {
    const uid = Number(req.params.uid);
    const { role, specialty } = req.body || {};
    if (!(role in ACTIVITY_ROLES)) return res.status(400).json({ error: 'role' });
    if (uid === req.account.id && req.account.role !== 'admin') return res.status(400).json({ error: 'self' });
    const r = central.prepare('UPDATE memberships SET role = ?, specialty = ? WHERE activity_id = ? AND user_id = ?')
      .run(role, role === 'responder' ? parseSpecialties(specialty).join(',') || null : null, req.activity.id, uid);
    if (!r.changes) return res.status(404).json({ error: 'not found' });
    // Giving a waiting account a role in the activity approves the account too.
    if (role !== 'pending') central.prepare("UPDATE users SET role = 'user' WHERE id = ? AND role = 'pending'").run(uid);
    res.json({ ok: true });
  });

  ar.delete('/admin/members/:uid', lead, (req, res) => {
    const uid = Number(req.params.uid);
    if (uid === req.account.id && req.account.role !== 'admin') return res.status(400).json({ error: 'self' });
    central.prepare('DELETE FROM memberships WHERE activity_id = ? AND user_id = ?').run(req.activity.id, uid);
    res.json({ ok: true });
  });

  ar.get('/admin/join', lead, (req, res) => {
    const a = getActivity(req.activity.id);
    res.json({ token: a.status === 'live' ? a.join_token : null, open: !!a.join_open && a.status === 'live' });
  });

  ar.post('/admin/join', lead, (req, res) => {
    if (req.archived) return res.status(409).json({ error: 'archived' });
    const b = req.body || {};
    if (b.regenerate) central.prepare('UPDATE activities SET join_token = ? WHERE id = ?').run(token(), req.activity.id);
    if (b.open != null) central.prepare('UPDATE activities SET join_open = ? WHERE id = ?').run(b.open ? 1 : 0, req.activity.id);
    res.json({ ok: true });
  });

  ar.get('/admin/summary', lead, (req, res) => res.json(summary()));

  // CSV for analysis. Without ?pii=1: no names, contacts, house numbers, positions, notes or screening scores.
  ar.get('/admin/export/:what.csv', lead, (req, res) => {
    const pii = req.query.pii === '1';
    const make = { visits: visitsCsv, tickets: ticketsCsv, repairs: repairsCsv, volunteers: volunteersCsv }[req.params.what];
    if (!make) return res.status(404).json({ error: 'not found' });
    const rows = make(pii);
    const name = `${req.params.what}-a${req.activity.id}${req.test ? '-test' : ''}${pii ? '-pii' : ''}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${name}"`)
      .send(`﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`);
  });

  // A consistent copy of the activity's database (VACUUM INTO works on live and read-only files alike). Contacts stay
  // encrypted unless an admin asks for ?decrypt=1, which adds plaintext phone/line/email columns to the copy.
  ar.get('/admin/export/snapshot.db', lead, (req, res) => {
    const decryptIt = req.query.decrypt === '1';
    if (decryptIt && req.account.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const tmp = path.join(DATA_DIR, 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const file = path.join(tmp, `${crypto.randomUUID()}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    if (decryptIt) decryptCopy(file);
    const name = `buuflood-a${req.activity.id}${req.test ? '-test' : ''}${decryptIt ? '-decrypted' : ''}-${new Date().toISOString().slice(0, 10)}.db`;
    res.download(file, name, () => fs.rm(file, { force: true }, () => {}));
  });
}

function decryptCopy(file) {
  const d = new DatabaseSync(file);
  for (const t of ['visits', 'repair_items']) {
    for (const c of ['phone', 'line', 'email']) d.exec(`ALTER TABLE ${t} ADD COLUMN ${c} TEXT`);
    const upd = d.prepare(`UPDATE ${t} SET phone = ?, line = ?, email = ? WHERE id = ?`);
    for (const r of d.prepare(`SELECT id, phone_enc, line_enc, email_enc FROM ${t}`).all()) {
      upd.run(decrypt(r.phone_enc), decrypt(r.line_enc), decrypt(r.email_enc), r.id);
    }
  }
  d.close();
}

// ---------------------------------------------------------------- summary and CSV (current request's database)

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const local = (t) => (t ? new Date(`${t.replace(' ', 'T')}Z`).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }) : '');
const LEVEL_LABELS = { red: 'แดง', yellow: 'เหลือง', green: 'เขียว' };
const needLabel = (id) => NEEDS.find((n) => n.id === id)?.label || id;
const levelOf = (v) => v.override_level || v.triage_level;
const countBy = (rows, key) => rows.reduce((m, r) => { const k = key(r) ?? '-'; m[k] = (m[k] || 0) + 1; return m; }, {});

export function summary() {
  const visits = db.prepare('SELECT id, created_at, created_by, triage_level, override_level, address, answers, triage, location_source, repair_needs FROM visits').all();
  const tickets = db.prepare('SELECT category, level, status FROM tickets').all();
  const items = db.prepare('SELECT type, status FROM repair_items WHERE visit_id IS NULL').all();
  const needs = {};
  const repairNeeds = {};
  for (const v of visits) {
    for (const n of json(v.answers, {}).needs || []) needs[n] = (needs[n] || 0) + 1;
    for (const it of json(v.repair_needs, [])) repairNeeds[it.type] = (repairNeeds[it.type] || 0) + 1;
  }
  const areas = countBy(visits, (v) => { const a = json(v.address, {}); return [a.tambon && `ต.${a.tambon}`, a.amphoe && `อ.${a.amphoe}`].filter(Boolean).join(' ') || null; });
  return {
    visits: visits.length,
    volunteers: new Set(visits.map((v) => v.created_by)).size,
    first: visits.length ? visits.reduce((m, v) => (v.created_at < m ? v.created_at : m), visits[0].created_at) : null,
    last: visits.length ? visits.reduce((m, v) => (v.created_at > m ? v.created_at : m), visits[0].created_at) : null,
    by_day: countBy(visits, (v) => local(v.created_at).slice(0, 10)),
    levels: countBy(visits, levelOf),
    location: countBy(visits, (v) => v.location_source || 'gps'),
    mental: countBy(visits.filter((v) => json(v.triage, {}).mental), (v) => json(v.triage, {}).mental.level),
    needs: Object.entries(needs).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, label: needLabel(id), n })),
    areas: Object.entries(areas).sort((a, b) => b[1] - a[1]).map(([area, n]) => ({ area, n })),
    tickets: Object.entries(countBy(tickets, (t) => t.category)).map(([category, n]) => ({
      category, label: CATEGORIES[category]?.label || category, n,
      open: tickets.filter((t) => t.category === category && !['done', 'referred'].includes(t.status)).length,
      red: tickets.filter((t) => t.category === category && t.level === 'red').length })),
    ticket_status: countBy(tickets, (t) => t.status),
    repair_needs: Object.entries(repairNeeds).map(([type, n]) => ({ type, label: REPAIR_TYPES[type] || type, n })),
    repairs: { total: items.length, by_type: Object.entries(countBy(items, (i) => i.type)).map(([type, n]) => ({ type, label: REPAIR_TYPES[type] || type, n })),
      by_status: countBy(items, (i) => i.status) },
  };
}

function visitsCsv(pii) {
  const head = ['เลขที่', 'บันทึกเมื่อ', 'ระดับ', 'ระดับที่คำนวณ', 'ความต้องการ', 'เดินทางไม่ได้', 'หมู่', 'หมู่บ้าน', 'ตำบล', 'อำเภอ', 'จังหวัด',
    'ตำแหน่งจาก', 'สุขภาพใจ', 'งานทั้งหมด', 'งานที่ยังเปิด', 'ของที่ต้องซ่อม', 'อาสาสมัคร'];
  if (pii) head.push('ชื่อ', 'นามสกุล', 'ชื่อเล่น', 'โทรศัพท์', 'LINE', 'อีเมล', 'บ้านเลขที่', 'ซอย', 'ถนน', 'lat', 'lng', '9Q', '8Q', 'เหตุผลปรับระดับ', 'หมายเหตุ');
  const tk = db.prepare("SELECT COUNT(*) AS n, SUM(status NOT IN ('done','referred')) AS open FROM tickets WHERE visit_id = ?");
  const rows = db.prepare('SELECT v.*, u.name AS volunteer FROM visits v LEFT JOIN users u ON u.id = v.created_by ORDER BY v.id').all().map((v) => {
    const a = json(v.address, {}); const ans = json(v.answers, {}); const m = json(v.triage, {}).mental; const t = tk.get(v.id);
    const r = [v.id, local(v.created_at), LEVEL_LABELS[levelOf(v)] || levelOf(v), LEVEL_LABELS[v.triage_level] || v.triage_level,
      (ans.needs || []).map(needLabel).join('; ') + (ans.other_need && pii ? `; อื่น ๆ: ${ans.other_need}` : ''), ans.cannot_travel ? 'ใช่' : '',
      a.moo, a.village, a.tambon, a.amphoe, a.province, v.location_source === 'address' ? 'ที่อยู่' : 'GPS',
      m ? LEVEL_LABELS[m.level] || m.level : '', t.n, t.open || 0,
      json(v.repair_needs, []).map((n) => REPAIR_TYPES[n.type] || n.type).join('; '), v.volunteer];
    if (pii) r.push(v.first_name, v.last_name, v.nickname, decrypt(v.phone_enc), decrypt(v.line_enc), decrypt(v.email_enc),
      a.house_no, a.soi, a.road, v.lat, v.lng, m?.q9, m?.q8, v.override_reason, v.notes);
    return r;
  });
  return [head, ...rows];
}

function ticketsCsv(pii) {
  const head = ['งาน', 'บันทึกเยี่ยมบ้าน', 'หมวด', 'ระดับ', 'สถานะ', 'ผู้รับผิดชอบ', 'สร้างเมื่อ', 'อัปเดตล่าสุด', 'ตำบล', 'อำเภอ'];
  if (pii) head.push('ชื่อ', 'นามสกุล', 'โทรศัพท์', 'บันทึกล่าสุด');
  const last = db.prepare('SELECT note FROM ticket_updates WHERE ticket_id = ? AND note IS NOT NULL ORDER BY id DESC LIMIT 1');
  const rows = db.prepare(`SELECT t.*, v.address, v.first_name, v.last_name, v.phone_enc, u.name AS assignee FROM tickets t
    JOIN visits v ON v.id = t.visit_id LEFT JOIN users u ON u.id = t.assignee_id ORDER BY t.id`).all().map((t) => {
    const a = json(t.address, {});
    const r = [t.id, t.visit_id, CATEGORIES[t.category]?.label || t.category, LEVEL_LABELS[t.level] || t.level,
      TICKET_STATUS[t.status] || t.status, t.assignee, local(t.created_at), local(t.updated_at), a.tambon, a.amphoe];
    if (pii) r.push(t.first_name, t.last_name, decrypt(t.phone_enc), last.get(t.id)?.note);
    return r;
  });
  return [head, ...rows];
}

// Everyone who worked in the activity (its own copy of the accounts, so removed accounts are listed too), with what
// they recorded. The phone is the account's current one, or the one kept in the activity's copy.
function volunteersCsv(pii) {
  const ROLE = { ...ACTIVITY_ROLES, admin: 'ผู้ดูแลระบบ' };
  const head = ['ชื่อ', 'อีเมล', 'บทบาท', 'ด้าน', 'บันทึกเยี่ยมบ้าน', 'งานที่รับ', 'รับของเข้าศูนย์ซ่อม', 'ใช้งานล่าสุด'];
  if (pii) head.push('โทรศัพท์');
  const now = central.prepare('SELECT phone_enc FROM users WHERE id = ?');
  const rows = db.prepare(`SELECT u.*,
      (SELECT COUNT(*) FROM visits v WHERE v.created_by = u.id) AS visits,
      (SELECT COUNT(*) FROM tickets t WHERE t.assignee_id = u.id) AS tickets,
      (SELECT COUNT(*) FROM repair_items r WHERE r.created_by = u.id AND r.visit_id IS NULL) AS repairs
    FROM users u ORDER BY visits DESC, u.name`).all()
    .filter((u) => u.visits || u.tickets || u.repairs || u.role !== 'admin')
    .map((u) => {
      const r = [u.name, u.email, ROLE[u.role] || u.role, parseSpecialties(u.specialty).map((k) => SPECIALTIES[k]).join(', '), u.visits, u.tickets, u.repairs, local(u.last_login)];
      if (pii) r.push(decrypt(now.get(u.id)?.phone_enc ?? u.phone_enc));
      return r;
    });
  return [head, ...rows];
}

function repairsCsv(pii) {
  const head = ['เลขคิว', 'ประเภท', 'ระบุประเภท', 'อาการ', 'สถานะ', 'ตำบล', 'อำเภอ', 'ลงทะเบียน', 'อัปเดตล่าสุด'];
  if (pii) head.push('เจ้าของ', 'โทรศัพท์', 'LINE', 'ยี่ห้อ/รุ่น');
  const rows = db.prepare('SELECT * FROM repair_items ORDER BY type, seq').all().map((r) => {
    const a = json(r.area, {});
    const out = [queueNo(r.type, r.seq), REPAIR_TYPES[r.type] || r.type, r.type_other, r.problem, REPAIR_STATUS[r.status] || r.status,
      a.tambon, a.amphoe, local(r.created_at), local(r.updated_at)];
    if (pii) out.push(r.owner_name, decrypt(r.phone_enc), decrypt(r.line_enc), r.brand);
    return out;
  });
  return [head, ...rows];
}
