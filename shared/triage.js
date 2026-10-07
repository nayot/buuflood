// Triage rules shared by the client (live preview) and the server (authoritative result).
// Edit this file to change the questions or how they are graded. The mental-health screening (2Q/9Q/8Q) is in
// mental.js and the Fixing Centre item types in repairs.js.
//
// Mental-health level: ticking any สุขภาพใจ need starts the 2Q/9Q/8Q screening, and the category takes the
// screening's level. `m_crisis` ticked is red whatever the screening says. "Cannot travel" still lifts green to yellow.
//
// Levels: green < yellow < red.
//   red    — danger to life or health: visit urgently, refer onwards
//   yellow — at risk or cannot travel: expert home visit by appointment
//   green  — not urgent: come to the service station (อบต. / รพ.สต.)

import { scoreMental } from './mental.js';

export const LEVELS = ['green', 'yellow', 'red'];

export const LEVEL_LABELS = {
  green: 'เขียว · มาที่จุดบริการ',
  yellow: 'เหลือง · เยี่ยมบ้าน',
  red: 'แดง · เร่งด่วน',
};

// Ticket categories. `specialty` is the responder specialty that handles it;
// `office` means the office role (อบต. / Help Centre) handles it. Responders see only their own specialties.
export const CATEGORIES = {
  electrical: { label: 'ไฟฟ้า', icon: '⚡', specialty: 'electrical' },
  structural: { label: 'โครงสร้างบ้าน', icon: '🏠', specialty: 'structural' },
  physical: { label: 'สุขภาพกาย', icon: '🩺', specialty: 'physical' },
  mental: { label: 'สุขภาพใจ', icon: '💛', specialty: 'mental' },
  basic: { label: 'อาหาร น้ำ เสื้อผ้า', icon: '🍚', specialty: 'office' },
  general: { label: 'อื่น ๆ', icon: '📌', specialty: 'office' },
};

export const SPECIALTIES = {
  electrical: 'ไฟฟ้า',
  structural: 'โครงสร้างบ้าน',
  physical: 'สุขภาพกาย',
  mental: 'สุขภาพใจ',
};

// A responder can have several specialties, stored as a comma-separated list ("electrical,structural").
export function parseSpecialties(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(list.map((s) => String(s).trim()).filter((s) => s in SPECIALTIES))];
}

// The needs checklist the volunteer asks about. Each item belongs to a category and has a level.
export const NEEDS = [
  { id: 'e_shock', cat: 'electrical', level: 'red', label: 'มีไฟรั่ว ไฟดูด หรือเบรกเกอร์ตัดบ่อย' },
  { id: 'e_wiring', cat: 'electrical', level: 'yellow', label: 'ตู้ไฟ ปลั๊ก หรือสายไฟในบ้านจมน้ำ' },
  { id: 'e_nopower', cat: 'electrical', level: 'yellow', label: 'ยังไม่กล้าเปิดไฟ หรือยังใช้ไฟไม่ได้' },
  { id: 'e_appliance', cat: 'electrical', level: 'green', label: 'เครื่องใช้ไฟฟ้าจมน้ำ ต้องการให้ตรวจ' },

  { id: 's_collapse', cat: 'structural', level: 'red', label: 'บ้านเอียง ทรุดมาก หรือมีส่วนที่เสี่ยงพังถล่ม' },
  { id: 's_cracks', cat: 'structural', level: 'yellow', label: 'ผนัง เสา หรือพื้นร้าว ทรุดตัว' },
  { id: 's_advice', cat: 'structural', level: 'green', label: 'ต้องการคำแนะนำการซ่อมแซมบ้าน' },

  { id: 'p_bedridden', cat: 'physical', level: 'red', label: 'มีผู้ป่วยติดเตียงที่ขาดผู้ดูแล' },
  { id: 'p_acute', cat: 'physical', level: 'red', label: 'มีผู้บาดเจ็บหรือป่วยเฉียบพลัน (ไข้สูง แผลติดเชื้อ หายใจลำบาก)' },
  { id: 'p_nomeds', cat: 'physical', level: 'yellow', label: 'ผู้ป่วยโรคเรื้อรังขาดยา' },
  { id: 'p_vulnerable', cat: 'physical', level: 'yellow', label: 'มีผู้สูงอายุ เด็กเล็ก หญิงตั้งครรภ์ หรือผู้พิการ' },
  { id: 'p_minor', cat: 'physical', level: 'green', label: 'ผื่น คัน น้ำกัดเท้า ต้องการคำแนะนำ' },

  { id: 'm_crisis', cat: 'mental', level: 'red', label: 'มีความคิดทำร้ายตนเอง หรือภาวะวิกฤตทางใจ' },
  { id: 'm_stress', cat: 'mental', level: 'yellow', label: 'เครียดมาก นอนไม่หลับ หรือซึมเศร้า' },
  { id: 'm_talk', cat: 'mental', level: 'green', label: 'ต้องการคนรับฟัง หรือคำแนะนำ' },

  { id: 'b_food', cat: 'basic', level: 'green', label: 'อาหาร' },
  { id: 'b_water', cat: 'basic', level: 'green', label: 'น้ำดื่ม' },
  { id: 'b_clothes', cat: 'basic', level: 'green', label: 'เสื้อผ้า เครื่องนอน' },
];

// Answer key: cannot travel to the service station.
export const IMMOBILE_ID = 'cannot_travel';

const rank = (l) => LEVELS.indexOf(l);
export const maxLevel = (a, b) => (rank(a) >= rank(b) ? a : b);

export const needsMentalScreening = (answers = {}) =>
  (answers.needs || []).some((id) => NEEDS.find((n) => n.id === id)?.cat === 'mental');

/**
 * Grade a visit.
 * @param {{needs: string[], cannot_travel?: boolean, other_need?: string, mental?: object}} answers
 * @returns {{level: string|null, categories: Record<string,{level:string, items:string[]}>, reasons: string[],
 *   mental: object|null}}  `mental` is the 2Q/9Q/8Q result when a mental need is ticked.
 */
export function triage(answers = {}) {
  const picked = new Set(answers.needs || []);
  const categories = {};
  const reasons = [];
  for (const n of NEEDS) {
    if (!picked.has(n.id)) continue;
    const c = (categories[n.cat] ||= { level: 'green', items: [] });
    if (n.cat !== 'mental') c.level = maxLevel(c.level, n.level);
    c.items.push(n.id);
    if (n.level !== 'green' && n.cat !== 'mental') reasons.push(n.label);
  }
  let mental = null;
  if (categories.mental) {
    mental = scoreMental(answers.mental);
    const crisis = picked.has('m_crisis');
    categories.mental.level = crisis ? 'red' : mental.level || 'green';
    if (crisis) reasons.push(NEEDS.find((n) => n.id === 'm_crisis').label);
    if (mental.complete && mental.level !== 'green') reasons.push(`สุขภาพใจ: ${mental.summary}${mental.flags.length ? ` (${mental.flags.join(', ')})` : ''}`);
  }
  if (answers.other_need && answers.other_need.trim()) {
    categories.general ||= { level: 'green', items: [] };
  }
  // Someone who cannot travel to the station needs a home visit for every non-supply need.
  if (answers.cannot_travel) {
    for (const [cat, c] of Object.entries(categories)) {
      if (cat !== 'basic' && c.level === 'green') {
        c.level = 'yellow';
      }
    }
    if (Object.keys(categories).length) reasons.push('เดินทางมาจุดบริการเองไม่ได้');
  }
  let level = null;
  for (const c of Object.values(categories)) level = level ? maxLevel(level, c.level) : c.level;
  return { level, categories, reasons, mental };
}

/**
 * Which tickets a visit opens. Yellow and red needs go to responders; supply needs always go to the office.
 * A volunteer override sets every ticket to that level (and opens a general ticket if nothing else is open).
 */
export function ticketsFor(result, override) {
  const out = [];
  for (const [cat, c] of Object.entries(result.categories)) {
    const level = override || c.level;
    if (cat === 'basic' || level !== 'green') out.push({ category: cat, level });
  }
  if (override && override !== 'green' && !out.some((t) => t.category !== 'basic')) {
    out.push({ category: 'general', level: override });
  }
  return out;
}

export const TICKET_STATUS = {
  open: 'ใหม่',
  claimed: 'รับเรื่องแล้ว',
  in_progress: 'กำลังดำเนินการ',
  done: 'เสร็จสิ้น',
  referred: 'ส่งต่อ',
};
