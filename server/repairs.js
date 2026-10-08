// Fixing Centre (ศูนย์ซ่อม): repair items with a queue number per type, photos, status history and a report.
import fs from 'node:fs';
import path from 'node:path';
import { db, json } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { REPAIR_TYPES, REPAIR_STATUS, ITEM_PHOTOS_MAX, ITEMS_MAX, queueNo } from '../shared/repairs.js';
import { contactError, cleanPhone, cleanLine, cleanEmail } from '../shared/contact.js';

export const STAFF = ['fixer', 'office', 'admin'];
const TYPE_ORDER = Object.keys(REPAIR_TYPES);
const str = (v, max = 200) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const AREA_KEYS = ['moo', 'village', 'tambon', 'amphoe', 'province'];
export const areaOf = (a = {}) => Object.fromEntries(AREA_KEYS.map((k) => [k, str(a[k], 100)]));
export const removeFiles = (files) => { for (const f of files || []) fs.rm(f.path, () => {}); };

/** Check the items of a visit or walk-in against the uploaded files. Returns an error code or null.
 *  Walk-ins need 1-4 photos per item; home visits (`photoRequired: false`) need none, but may still send them. */
export function itemsError(items, files, { photoRequired = true } = {}) {
  if (!Array.isArray(items)) return 'items';
  if (items.length > ITEMS_MAX) return 'too many items';
  const seen = new Set();
  for (const it of items) {
    if (!it?.uuid || seen.has(String(it.uuid))) return 'item uuid';
    seen.add(String(it.uuid));
    if (!(it.type in REPAIR_TYPES)) return 'item type';
    if (it.type === 'OT' && !str(it.type_other)) return 'item type_other';
    const n = (files || []).filter((f) => f.fieldname === `item_${it.uuid}`).length;
    if (photoRequired && n < 1) return 'item photo required';
    if (n > ITEM_PHOTOS_MAX) return 'too many item photos';
  }
  return null;
}

/** Insert items with the next queue number of their type. Call inside a transaction. */
export function insertItems({ items, files, owner, visitId, userId }) {
  const nextSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM repair_items WHERE type = ?');
  const ins = db.prepare(`INSERT INTO repair_items (uuid, type, seq, visit_id, created_by, owner_name, phone_enc, line_enc, email_enc,
    area, type_other, brand, problem) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insP = db.prepare('INSERT INTO repair_photos (item_id, filename) VALUES (?, ?)');
  const out = [];
  for (const it of items) {
    const seq = nextSeq.get(it.type).n;
    const id = Number(ins.run(String(it.uuid), it.type, seq, visitId ?? null, userId, owner.name,
      encrypt(cleanPhone(owner.phone)), encrypt(cleanLine(owner.line)), encrypt(cleanEmail(owner.email)),
      JSON.stringify(areaOf(owner.area)), it.type === 'OT' ? str(it.type_other, 100) : null, str(it.brand, 100), str(it.problem, 500)).lastInsertRowid);
    for (const f of files.filter((x) => x.fieldname === `item_${it.uuid}`)) insP.run(id, f.filename);
    out.push({ id, queue: queueNo(it.type, seq) });
  }
  return out;
}

export function serializeItem(r) {
  return {
    id: r.id, queue: queueNo(r.type, r.seq), type: r.type, seq: r.seq, type_label: REPAIR_TYPES[r.type] || r.type,
    type_other: r.type_other, brand: r.brand, problem: r.problem, status: r.status,
    owner_name: r.owner_name, phone: decrypt(r.phone_enc), line: decrypt(r.line_enc), email: decrypt(r.email_enc),
    area: json(r.area, {}), visit_id: r.visit_id, created_at: r.created_at, updated_at: r.updated_at,
    photos: db.prepare('SELECT id FROM repair_photos WHERE item_id = ? ORDER BY id').all(r.id).map((p) => p.id),
  };
}

/** Items of one visit (queue number, type, status) for the visit pages. */
export const itemsOfVisit = (visitId) =>
  db.prepare('SELECT * FROM repair_items WHERE visit_id = ? ORDER BY id').all(visitId).map(serializeItem);

function canSee(user, item) {
  if (!user || !item) return false;
  if (STAFF.includes(user.role) || item.created_by === user.id) return true;
  return !!(item.visit_id && db.prepare('SELECT 1 FROM visits WHERE id = ? AND created_by = ?').get(item.visit_id, user.id));
}

const sortItems = (rows) => rows.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.seq - b.seq);

function listItems(q) {
  const where = ['1=1'];
  const args = [];
  if (q.type in REPAIR_TYPES) { where.push('type = ?'); args.push(q.type); }
  if (q.status in REPAIR_STATUS) { where.push('status = ?'); args.push(q.status); }
  if (q.open === '1') where.push("status NOT IN ('returned','unfixable')");
  const rows = sortItems(db.prepare(`SELECT * FROM repair_items WHERE ${where.join(' AND ')}`).all(...args)).map(serializeItem);
  const s = String(q.q || '').trim().toLowerCase();
  return s ? rows.filter((r) => [r.queue, r.owner_name, r.phone, r.line, r.brand].some((x) => String(x || '').toLowerCase().includes(s))) : rows;
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
// SQLite stores UTC; the report shows Thai local time.
const local = (t) => (t ? new Date(`${t.replace(' ', 'T')}Z`).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }) : '');

export function mountRepairs(app, { need, upload }) {
  app.get('/api/repairs', need(...STAFF), (req, res) => res.json(listItems(req.query)));

  // Report: every item, grouped by type and in queue order. UTF-8 BOM so Excel reads the Thai.
  app.get('/api/repairs/report.csv', need(...STAFF), (req, res) => {
    const head = ['เลขคิว', 'ประเภท', 'ระบุประเภท', 'ยี่ห้อ/รุ่น', 'อาการ', 'สถานะ', 'เจ้าของ', 'โทรศัพท์', 'LINE', 'อีเมล',
      'หมู่', 'หมู่บ้าน', 'ตำบล', 'อำเภอ', 'จังหวัด', 'ลงทะเบียน', 'อัปเดตล่าสุด', 'บันทึกเยี่ยมบ้าน'];
    const lines = listItems(req.query).map((r) => [r.queue, r.type_label, r.type_other, r.brand, r.problem, REPAIR_STATUS[r.status],
      r.owner_name, r.phone, r.line, r.email, r.area.moo, r.area.village, r.area.tambon, r.area.amphoe, r.area.province,
      local(r.created_at), local(r.updated_at), r.visit_id ? `#${r.visit_id}` : 'รับที่ศูนย์'].map(csvCell).join(','));
    res.set('Content-Type', 'text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="repairs-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(`﻿${[head.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`);
  });

  app.get('/api/repairs/:id', need(), (req, res) => {
    const r = db.prepare('SELECT * FROM repair_items WHERE id = ?').get(Number(req.params.id));
    if (!canSee(req.user, r)) return res.status(404).json({ error: 'not found' });
    const out = serializeItem(r);
    out.creator = db.prepare('SELECT name FROM users WHERE id = ?').get(r.created_by)?.name;
    out.updates = db.prepare('SELECT ru.*, u.name FROM repair_updates ru JOIN users u ON u.id = ru.user_id WHERE item_id = ? ORDER BY ru.id').all(r.id);
    out.can_update = STAFF.includes(req.user.role);
    res.json(out);
  });

  app.get('/api/repair-photos/:id', need(), (req, res) => {
    const p = db.prepare('SELECT p.filename, r.* FROM repair_photos p JOIN repair_items r ON r.id = p.item_id WHERE p.id = ?').get(Number(req.params.id));
    if (!p || !canSee(req.user, p)) return res.status(404).end();
    res.sendFile(path.join(req.uploadDir, path.basename(p.filename)));
  });

  // Walk-in at the centre: owner + items in one request. Online only, so the queue numbers come back at once.
  app.post('/api/repairs', need(...STAFF), upload, (req, res) => {
    const files = req.files || [];
    let d;
    try { d = JSON.parse(req.body.data || '{}'); } catch { removeFiles(files); return res.status(400).json({ error: 'bad data' }); }
    const fail = (error) => { removeFiles(files); return res.status(400).json({ error }); };
    if (!d.uuid) return fail('uuid required');
    const dup = db.prepare('SELECT 1 FROM repair_items WHERE uuid = ?').get(`${d.uuid}:0`);
    if (dup) {
      removeFiles(files);
      const items = db.prepare("SELECT * FROM repair_items WHERE uuid LIKE ? ORDER BY id").all(`${d.uuid}:%`).map(serializeItem);
      return res.json({ items: items.map((i) => ({ id: i.id, queue: i.queue })), duplicate: true });
    }
    const name = `${str(d.first_name, 100) || ''} ${str(d.last_name, 100) || ''}`.trim();
    if (!str(d.first_name) || !str(d.last_name)) return fail('name required');
    const ce = contactError(d);
    if (ce) return fail('contact required');
    const err = itemsError(d.items, files);
    if (err) return fail(err);
    if (!d.items.length) return fail('items required');
    // Item uuids are namespaced by the request uuid so a retried walk-in is recognised by its first item.
    const items = d.items.map((it, i) => ({ ...it, file_uuid: it.uuid, uuid: `${d.uuid}:${i}` }));
    const filesRenamed = files.map((f) => {
      const it = items.find((x) => f.fieldname === `item_${x.file_uuid}`);
      return it ? { ...f, fieldname: `item_${it.uuid}` } : f;
    });
    db.exec('BEGIN');
    try {
      const out = insertItems({ items, files: filesRenamed, owner: { name, phone: d.phone, line: d.line, email: d.email, area: d.area }, visitId: null, userId: req.user.id });
      const insU = db.prepare('INSERT INTO repair_updates (item_id, user_id, status, note) VALUES (?, ?, ?, ?)');
      const setS = db.prepare("UPDATE repair_items SET status = 'received' WHERE id = ?");
      for (const o of out) { setS.run(o.id); insU.run(o.id, req.user.id, 'received', 'รับเข้าศูนย์ (ลงทะเบียนที่ศูนย์)'); }
      db.exec('COMMIT');
      res.json({ items: out });
    } catch (e) {
      db.exec('ROLLBACK');
      removeFiles(files);
      console.error(e);
      res.status(500).json({ error: 'save failed' });
    }
  });

  app.post('/api/repairs/:id/update', need(...STAFF), (req, res) => {
    const r = db.prepare('SELECT * FROM repair_items WHERE id = ?').get(Number(req.params.id));
    if (!r) return res.status(404).json({ error: 'not found' });
    const status = req.body?.status in REPAIR_STATUS ? req.body.status : r.status;
    const note = str(req.body?.note, 1000);
    if (status === r.status && !note) return res.status(400).json({ error: 'nothing to update' });
    db.prepare("UPDATE repair_items SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, r.id);
    db.prepare('INSERT INTO repair_updates (item_id, user_id, status, note) VALUES (?, ?, ?, ?)').run(r.id, req.user.id, status, note);
    res.json({ ok: true });
  });
}
