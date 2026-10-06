// Delete household data (visits, tickets, photos, check-ins) for PDPA retention.
//   npm run purge -- --older-than 90     delete visits older than 90 days
//   npm run purge -- --all --yes         delete everything except user accounts
// In Docker: docker compose exec app node scripts/purge.js --older-than 90
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR } from '../server/db.js';

const args = process.argv.slice(2);
const all = args.includes('--all');
const days = Number(args[args.indexOf('--older-than') + 1]);

if (!all && !(days > 0)) {
  console.log('Usage: purge.js --older-than <days> | --all --yes');
  process.exit(1);
}
if (all && !args.includes('--yes')) {
  console.log('Refusing to delete everything without --yes');
  process.exit(1);
}

const where = all ? '1=1' : `created_at < datetime('now', '-${Math.floor(days)} days')`;
const photos = db.prepare(`SELECT filename FROM photos WHERE visit_id IN (SELECT id FROM visits WHERE ${where})`).all();
const n = db.prepare(`SELECT COUNT(*) AS n FROM visits WHERE ${where}`).get().n;

db.exec('BEGIN');
db.prepare(`DELETE FROM visits WHERE ${where}`).run(); // tickets, updates and photo rows cascade
if (all) db.exec('DELETE FROM checkins');
db.exec('COMMIT');

for (const p of photos) fs.rmSync(path.join(UPLOAD_DIR, path.basename(p.filename)), { force: true });
db.exec('VACUUM');
console.log(`Deleted ${n} visits and ${photos.length} photos.`);
