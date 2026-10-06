// Triage rules shared by the client (live preview) and the server (authoritative result).
// Edit this file to change the questions or how they are graded.
//
// Levels: green < yellow < red.
//   red    — danger to life or health: visit urgently, refer onwards
//   yellow — at risk or cannot travel: expert home visit by appointment
//   green  — not urgent: come to the service station (อบต. / รพ.สต.)

export const LEVELS = ['green', 'yellow', 'red'];

export const LEVEL_LABELS = {
  green: 'เขียว · มาที่จุดบริการ',
  yellow: 'เหลือง · เยี่ยมบ้าน',
  red: 'แดง · เร่งด่วน',
};

// Ticket categories. `specialty` is the responder specialty that handles it;
// `office` means the office role (อบต. / Help Centre) handles it.
export const CATEGORIES = {
  electrical: { label: 'ไฟฟ้า', icon: '⚡', specialty: 'electrical' },
  structural: { label: 'โครงสร้างบ้าน', icon: '🏠', specialty: 'structural' },
  physical: { label: 'สุขภาพกาย', icon: '🩺', specialty: 'physical' },
  mental: { label: 'สุขภาพใจ', icon: '💛', specialty: 'mental' },
  basic: { label: 'อาหาร น้ำ เสื้อผ้า', icon: '🍚', specialty: 'office' },
  general: { label: 'อื่น ๆ', icon: '📌', specialty: 'any' },
};

export const SPECIALTIES = {
  electrical: 'ไฟฟ้า',
  structural: 'โครงสร้างบ้าน',
  physical: 'สุขภาพกาย',
  mental: 'สุขภาพใจ',
};

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

/**
 * Grade a visit.
 * @param {{needs: string[], cannot_travel?: boolean, other_need?: string}} answers
 * @returns {{level: string|null, categories: Record<string,{level:string, items:string[]}>, reasons: string[]}}
 */
export function triage(answers = {}) {
  const picked = new Set(answers.needs || []);
  const categories = {};
  const reasons = [];
  for (const n of NEEDS) {
    if (!picked.has(n.id)) continue;
    const c = (categories[n.cat] ||= { level: 'green', items: [] });
    c.level = maxLevel(c.level, n.level);
    c.items.push(n.id);
    if (n.level !== 'green') reasons.push(n.label);
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
  return { level, categories, reasons };
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

// The four cases on the government relief form (แบบคำร้องขอรับความช่วยเหลือผู้ประสบอุทกภัย).
export const RELIEF_CASES = {
  1: 'ที่อยู่อาศัยประจำอยู่ในพื้นที่น้ำท่วม ดินถล่ม น้ำท่วมฉับพลัน น้ำป่าไหลหลาก น้ำล้นตลิ่ง ไม่เกิน 7 วัน และทรัพย์สินได้รับความเสียหาย',
  2: 'ที่อยู่อาศัยประจำถูกน้ำท่วมขัง ติดต่อกัน เกินกว่า 7 วัน',
  3: 'ที่อยู่อาศัยประจำที่ถูกน้ำล้อมรอบ และได้รับผลกระทบ ติดต่อกัน เกินกว่า 7 วัน',
  4: 'ที่อยู่อาศัยประจำในอาคารสูงที่น้ำท่วมไม่ถึงชั้นที่ผู้ประสบภัยพักอาศัย และได้รับผลกระทบ ติดต่อกัน เกินกว่า 7 วัน',
};

export const RESIDENCE_TYPES = {
  registered: 'บ้านที่มีทะเบียนบ้าน',
  rented: 'บ้านเช่า',
  other: 'อื่น ๆ',
};

export const EVIDENCE = {
  id_card: 'บัตรประชาชน',
  lease: 'สัญญาเช่า/หนังสือรับรองการเช่าจาก อปท.',
  no_house_no: 'หนังสือรับรองบ้านไม่มีเลขที่',
  poa: 'หนังสือมอบอำนาจ',
};

export const TICKET_STATUS = {
  open: 'ใหม่',
  claimed: 'รับเรื่องแล้ว',
  in_progress: 'กำลังดำเนินการ',
  done: 'เสร็จสิ้น',
  referred: 'ส่งต่อ',
};
