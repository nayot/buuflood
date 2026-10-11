// Delete household data of one activity (visits, tickets, photos, repair items, check-ins) for PDPA retention.
//   npm run purge -- --activity 2 --older-than 90     delete that activity's visits older than 90 days
//   npm run purge -- --activity 2 --all --yes         delete everything in that activity (members are kept)
// Archived activities are read-only in the app: reopen the activity first, or remove personal data from the archive
// with "ลบข้อมูลส่วนบุคคล" on the activities page (keeps the statistics).
// In Docker: docker compose exec app node scripts/purge.js --activity 2 --older-than 90
// Back up first: docker compose cp app:/app/data ./backup-$(date +%F)
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { getActivity, activityDb, activityDir, central } from '../server/db.js';

const args = process.argv.slice(2);
const all = args.includes('--all');
const days = Number(args[args.indexOf('--older-than') + 1]);
const aid = Number(args[args.indexOf('--activity') + 1]);

if (!args.includes('--activity') || !(aid > 0) || (!all && !(days > 0))) {
  console.log('Usage: purge.js --activity <id> (--older-than <days> | --all --yes)');
  for (const a of central.prepare('SELECT id, name, status FROM activities ORDER BY id').all()) console.log(`  ${a.id}  ${a.status.padEnd(8)}  ${a.name}`);
  process.exit(1);
}
if (all && !args.includes('--yes')) {
  console.log('Refusing to delete everything without --yes');
  process.exit(1);
}
const a = getActivity(aid);
if (!a) { console.log(`No activity ${aid}`); process.exit(1); }
if (a.status === 'archived') { console.log(`Activity ${aid} is archived (read-only). Reopen it first.`); process.exit(1); }
const db = activityDb(aid);
const uploads = path.join(activityDir(aid), 'uploads');

const where = all ? '1=1' : `created_at < datetime('now', '-${Math.floor(days)} days')`;
// Repair items go with their visit, or by their own date when registered at the centre (no visit).
const itemWhere = `visit_id IN (SELECT id FROM visits WHERE ${where}) OR (visit_id IS NULL AND ${where})`;
const photos = [
  ...db.prepare(`SELECT filename FROM photos WHERE visit_id IN (SELECT id FROM visits WHERE ${where})`).all(),
  ...db.prepare(`SELECT filename FROM repair_photos WHERE item_id IN (SELECT id FROM repair_items WHERE ${itemWhere})`).all(),
];
const visitIds = db.prepare(`SELECT id FROM visits WHERE ${where}`).all().map((v) => v.id);
const items = db.prepare(`SELECT COUNT(*) AS n FROM repair_items WHERE ${itemWhere}`).get().n;

db.exec('BEGIN');
db.prepare(`DELETE FROM repair_items WHERE ${itemWhere}`).run(); // repair photo and update rows cascade
db.prepare(`DELETE FROM visits WHERE ${where}`).run(); // tickets, updates and photo rows cascade
if (all) db.exec('DELETE FROM checkins');
db.exec('COMMIT');
// LINE referrals (central database) go with their visit; those whose visit never arrived go by their own date.
const delRef = central.prepare('DELETE FROM line_referrals WHERE activity_id = ? AND test = 0 AND visit_id = ?');
for (const id of visitIds) delRef.run(aid, id);
central.prepare(`DELETE FROM line_referrals WHERE activity_id = ? AND visit_id IS NULL AND ${where}`).run(aid);

for (const p of photos) fs.rmSync(path.join(uploads, path.basename(p.filename)), { force: true });
db.exec('VACUUM');
console.log(`Activity ${aid} "${a.name}": deleted ${visitIds.length} visits, ${items} repair items and ${photos.length} photos.`);
