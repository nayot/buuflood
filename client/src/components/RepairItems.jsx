import { REPAIR_TYPES, ITEM_PHOTOS_MAX, ITEMS_MAX } from '../../../shared/repairs.js';
import { compressPhoto, uuid } from '../lib/device.js';
import { Field } from './ui.jsx';

export const blankItem = () => ({ uuid: uuid(), type: '', type_other: '', brand: '', problem: '', photos: [] }); // photos: { blob, url }

/** The first problem with the item list, as a Thai message, or null. Mirrors itemsError() on the server.
 *  `photos: false` for a home visit, where items are a survey of needs and take no photos. */
export function itemsProblem(items, { photos = true } = {}) {
  for (const [i, it] of items.entries()) {
    if (!it.type) return `สิ่งของที่ ${i + 1}: เลือกประเภท`;
    if (it.type === 'OT' && !it.type_other.trim()) return `สิ่งของที่ ${i + 1}: ระบุว่าเป็นอะไร`;
    if (photos && !it.photos.length) return `สิ่งของที่ ${i + 1}: ต้องมีรูปถ่ายอย่างน้อย 1 รูป`;
  }
  return null;
}

/** What goes into the request: item fields without the photos (those are sent as files "item_<uuid>"). */
export const itemsPayload = (items) => items.map(({ photos, ...rest }) => rest);

/** Damaged items to repair, each with its own photos (none with `photos={false}`). */
export default function RepairItems({ items, onChange, notify, photos = true }) {
  const patch = (i, p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const addPhotos = async (i, files) => {
    const added = [];
    for (const f of files) {
      try { const blob = await compressPhoto(f); added.push({ blob, url: URL.createObjectURL(blob) }); }
      catch { notify('ไม่สามารถอ่านรูปภาพนี้ได้'); }
    }
    patch(i, { photos: [...items[i].photos, ...added].slice(0, ITEM_PHOTOS_MAX) });
  };
  const remove = (i) => { items[i].photos.forEach((p) => URL.revokeObjectURL(p.url)); onChange(items.filter((_, j) => j !== i)); };

  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={it.uuid} className="rounded-xl border border-neutral-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <b>สิ่งของที่ {i + 1}</b>
            <button type="button" onClick={() => remove(i)} className="text-sm text-lvred underline">ลบ</button>
          </div>
          <Field label="ประเภท *">
            <select value={it.type} onChange={(e) => patch(i, { type: e.target.value })}>
              <option value="">เลือก…</option>
              {Object.entries(REPAIR_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          {it.type === 'OT' && <Field label="ระบุ *"><input value={it.type_other} onChange={(e) => patch(i, { type_other: e.target.value })} /></Field>}
          <div className="grid grid-cols-2 gap-2">
            <Field label="ยี่ห้อ/รุ่น"><input value={it.brand} onChange={(e) => patch(i, { brand: e.target.value })} /></Field>
            <Field label="อาการ"><input value={it.problem} onChange={(e) => patch(i, { problem: e.target.value })} placeholder="เช่น จมน้ำ สตาร์ทไม่ติด" /></Field>
          </div>
          {photos && <div className="grid grid-cols-4 gap-2">
            {it.photos.map((p, k) => (
              <div key={p.url} className="relative">
                <img src={p.url} alt="" className="aspect-square w-full object-cover rounded-lg" />
                <button type="button" onClick={() => { URL.revokeObjectURL(p.url); patch(i, { photos: it.photos.filter((_, j) => j !== k) }); }}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs">✕</button>
              </div>
            ))}
          </div>}
          {photos && it.photos.length < ITEM_PHOTOS_MAX && (
            <div className="grid grid-cols-2 gap-2">
              <label className={`cursor-pointer ${it.photos.length ? 'btn-ghost' : 'btn-gold'}`}>📷 ถ่ายรูป{it.photos.length ? '' : ' *'}
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addPhotos(i, [...e.target.files]); e.target.value = ''; }} />
              </label>
              <label className="btn-ghost cursor-pointer">🖼️ เลือกจากคลัง
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addPhotos(i, [...e.target.files]); e.target.value = ''; }} />
              </label>
            </div>
          )}
        </div>
      ))}
      {items.length < ITEMS_MAX && (
        <button type="button" onClick={() => onChange([...items, blankItem()])} className="btn-ghost w-full">➕ เพิ่มสิ่งของที่ต้องซ่อม</button>
      )}
    </div>
  );
}
