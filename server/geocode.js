// Approximate positions for visits recorded by address (met away from home, no map pin).
// Uses OpenStreetMap Nominatim: at most 1 request per second, with an identifying User-Agent.
// Only the village, tambon, amphoe and province are sent, never the house number or the villager's name.
import { json } from './db.js';

const UA = `buuflood (Burapha University flood recovery; ${process.env.PUBLIC_URL || 'local'})`;
const cache = new Map(); // query -> Nominatim hits, for the life of the process
let last = 0;

async function search(q) {
  if (cache.has(q)) return cache.get(q);
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=th&accept-language=th&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`nominatim HTTP ${r.status}`);
  const hits = await r.json();
  cache.set(q, hits);
  return hits;
}

/** Finest match among village, tambon and amphoe. Throws on network errors so the visit is retried later.
 * OSM's Thai names are patchy: "ตำบลX" often fails where the bare "X" matches, and bare names can match a place
 * with the same name elsewhere, so both forms are tried and a hit must lie in the given amphoe and province. */
async function locate(a = {}) {
  const { village, tambon, amphoe, province } = a;
  const tries = [
    ['village', village && tambon && [[village, tambon, amphoe, province], [village, `ตำบล${tambon}`, amphoe && `อำเภอ${amphoe}`, province && `จังหวัด${province}`]]],
    ['tambon', tambon && [[tambon, amphoe, province], [`ตำบล${tambon}`, amphoe && `อำเภอ${amphoe}`, province && `จังหวัด${province}`]]],
    ['amphoe', amphoe && [[amphoe, province], [`อำเภอ${amphoe}`, province && `จังหวัด${province}`]]],
  ];
  const inArea = (h) => [amphoe, province].every((n) => !n || (h.display_name || '').includes(n));
  for (const [level, forms] of tries) {
    for (const parts of forms || []) {
      const hit = (await search(parts.filter(Boolean).join(' '))).find(inArea);
      if (hit) return { lat: +(+hit.lat).toFixed(6), lng: +(+hit.lon).toFixed(6), level };
    }
  }
  return { lat: null, lng: null, level: 'none' };
}

// One sweep at a time per database (production, and the admin test-mode sandbox when it is open).
const state = new WeakMap(); // db -> { running, again }

/** Look up every address-mode visit without a pin in database `d` that has not been looked up yet. Safe to call often. */
export async function geocodePending(d) {
  const st = state.get(d) || { running: false, again: false };
  state.set(d, st);
  if (st.running) { st.again = true; return; }
  st.running = true;
  st.again = false;
  try {
    const rows = d.prepare(`SELECT id, address FROM visits
      WHERE location_source = 'address' AND lat IS NULL AND geocoded_at IS NULL ORDER BY id`).all();
    const save = d.prepare(`UPDATE visits SET approx_lat = ?, approx_lng = ?, approx_level = ?, geocoded_at = datetime('now') WHERE id = ?`);
    for (const v of rows) {
      const p = await locate(json(v.address, {}));
      if (!d.isOpen) return; // the sandbox was reset meanwhile
      save.run(p.lat, p.lng, p.level, v.id);
    }
  } catch (e) {
    console.warn(`geocode: ${e.message} (will retry)`);
    st.again = false; // stop after an error; the periodic sweep retries
  } finally {
    st.running = false;
    if (st.again) geocodePending(d);
  }
}
