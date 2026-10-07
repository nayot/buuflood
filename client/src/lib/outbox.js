// Visits are saved to the phone first (IndexedDB) and uploaded when there is signal.
// The server ignores a visit whose uuid it already has, so retries never create duplicates.
import { get, set } from 'idb-keyval';

const KEY = 'outbox';
const listeners = new Set();
let flushing = false;

async function read() { return (await get(KEY)) || []; }
async function write(items) { await set(KEY, items); listeners.forEach((fn) => fn(items.length)); }

export function onOutboxChange(fn) { listeners.add(fn); read().then((i) => fn(i.length)); return () => listeners.delete(fn); }

/** `itemPhotos` maps a repair item's uuid to its photo blobs; they are sent as files named "item_<uuid>". */
export async function enqueue(data, photos, itemPhotos = {}) {
  const items = await read();
  items.push({ uuid: data.uuid, data, photos, itemPhotos, tries: 0, queuedAt: Date.now() });
  await write(items);
  return flush();
}

/** Try to upload everything in the outbox. Returns the server's answers ({ uuid, id, repairs }) for the visits saved. */
export async function flush() {
  if (flushing || !navigator.onLine) return [];
  flushing = true;
  const saved = [];
  try {
    for (const item of await read()) {
      if (item.failed) continue; // rejected by the server; kept for the volunteer to see, not retried
      const fd = new FormData();
      fd.append('data', JSON.stringify(item.data));
      (item.photos || []).forEach((b, i) => fd.append('photos', b, `photo-${i + 1}.jpg`));
      for (const [id, blobs] of Object.entries(item.itemPhotos || {})) blobs.forEach((b, i) => fd.append(`item_${id}`, b, `item-${i + 1}.jpg`));
      let ok = false;
      let rejected = null;
      try {
        const r = await fetch('api/visits', { method: 'POST', body: fd, credentials: 'same-origin' });
        if (r.ok) { saved.push({ uuid: item.uuid, ...(await r.json()) }); ok = true; }
        else if (r.status === 401) break; // logged out: keep everything until they log in again
        else if (r.status >= 400 && r.status < 500) rejected = (await r.json().catch(() => ({}))).error || `HTTP ${r.status}`;
      } catch { /* network error: keep it and retry later */ }
      const items = await read();
      const idx = items.findIndex((x) => x.uuid === item.uuid);
      if (idx >= 0) {
        if (ok) items.splice(idx, 1);
        else { items[idx].tries += 1; if (rejected) items[idx].failed = rejected; }
        await write(items);
      }
      if (!ok && !rejected) break; // offline or server down: stop and retry later
    }
  } finally { flushing = false; }
  return saved;
}

export async function pending() { return read(); }

window.addEventListener('online', () => flush());
setInterval(() => flush(), 30000);
