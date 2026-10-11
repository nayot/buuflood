// Visits are saved to the phone first (IndexedDB) and uploaded when there is signal.
// The server ignores a visit whose uuid it already has, so retries never create duplicates.
import { get, set } from 'idb-keyval';
import { currentActivity } from './api.js';

// Admin test mode has its own outbox, and each queued visit carries its mode: the server only accepts it in that
// mode (409 otherwise), so a test visit can never be uploaded into the real data, nor a real one into the test data.
// 3.0: each queued visit also carries its activity and is sent to that activity, whichever one the screen shows.
// An archived activity answers 409: the visit stays on the phone (shown as waiting) for a manager to sort out.
const KEYS = { false: 'outbox', true: 'outbox-test' };
let test = false;
const listeners = new Set();
let flushing = false;

async function read(t = test) { return (await get(KEYS[t])) || []; }
async function write(items) { await set(KEYS[test], items); listeners.forEach((fn) => fn(items.length)); }

export function onOutboxChange(fn) { listeners.add(fn); read().then((i) => fn(i.length)); return () => listeners.delete(fn); }

/** Switch to the outbox of the given mode (from api/me). */
export function setOutboxMode(on) {
  test = !!on;
  read().then((items) => listeners.forEach((fn) => fn(items.length)));
}

/** Visits of a mode still waiting to be sent (not those the server rejected), e.g. to warn before switching modes. */
export const pendingIn = async (on) => (await read(!!on)).filter((i) => !i.failed).length;

/** Drop the unsent test visits (when leaving test mode). */
export async function clearTestOutbox() {
  await set(KEYS.true, []);
  if (test) listeners.forEach((fn) => fn(0));
}

/** `itemPhotos` maps a repair item's uuid to its photo blobs; they are sent as files named "item_<uuid>". */
export async function enqueue(data, photos, itemPhotos = {}) {
  const items = await read();
  items.push({ uuid: data.uuid, data: { ...data, test, activity: currentActivity() }, photos, itemPhotos, tries: 0, queuedAt: Date.now() });
  await write(items);
  return flush();
}

/** Try to upload everything in the outbox. Returns the server's answers ({ uuid, id, repairs }) for the visits saved. */
export async function flush() {
  if (flushing || !navigator.onLine) return [];
  flushing = true;
  const mode = test;
  const saved = [];
  try {
    for (const item of await read(mode)) {
      if (test !== mode) break; // the mode changed meanwhile
      if (item.failed) continue; // rejected by the server; kept for the volunteer to see, not retried
      const fd = new FormData();
      fd.append('data', JSON.stringify(item.data));
      (item.photos || []).forEach((b, i) => fd.append('photos', b, `photo-${i + 1}.jpg`));
      for (const [id, blobs] of Object.entries(item.itemPhotos || {})) blobs.forEach((b, i) => fd.append(`item_${id}`, b, `item-${i + 1}.jpg`));
      let ok = false;
      let rejected = null;
      try {
        const aid = item.data.activity ?? currentActivity();
        const r = await fetch(`api/a/${aid}/visits`, { method: 'POST', body: fd, credentials: 'same-origin' });
        if (r.ok) { saved.push({ uuid: item.uuid, ...(await r.json()) }); ok = true; }
        else if (r.status === 401) break; // logged out: keep everything until they log in again
        else if (r.status === 409) {
          const why = (await r.json().catch(() => ({}))).error;
          if (why === 'archived') { const all = await read(mode); const x = all.find((i) => i.uuid === item.uuid); if (x) { x.blocked = 'กิจกรรมนี้ปิดแล้ว'; await set(KEYS[mode], all); } continue; }
          break; // queued in the other mode: keep it until the phone is back in that mode
        }
        else if (r.status >= 400 && r.status < 500) rejected = (await r.json().catch(() => ({}))).error || `HTTP ${r.status}`;
      } catch { /* network error: keep it and retry later */ }
      const items = await read(mode);
      const idx = items.findIndex((x) => x.uuid === item.uuid);
      if (idx >= 0) {
        if (ok) items.splice(idx, 1);
        else { items[idx].tries += 1; if (rejected) items[idx].failed = rejected; }
        await set(KEYS[mode], items);
        if (test === mode) listeners.forEach((fn) => fn(items.length));
      }
      if (!ok && !rejected) break; // offline or server down: stop and retry later
    }
  } finally { flushing = false; }
  return saved;
}

export async function pending() { return read(); }

window.addEventListener('online', () => flush());
setInterval(() => flush(), 30000);
