// Depression and suicide-risk screening: 2Q, 9Q and 8Q of the Department of Mental Health (กรมสุขภาพจิต).
// Shared by the client (live result) and the server (authoritative result). Keep the wording exactly as the form.
//
// Flow: 2Q → if any "มี", 9Q → if 9Q ≥ 7 or 9Q item 9 > 0, 8Q.
// (The form asks 8Q from 9Q ≥ 7; we also ask it whenever 9Q item 9 — self-harm thoughts — is above 0.)
//
// Level (decided with the project, 8 Oct 2026):
//   red    — 8Q ≥ 9, or 8Q "cannot control" / plan / prepared / attempted, or 9Q ≥ 19: call for help now
//   yellow — 9Q 7–18 or 8Q 1–8: a mental-health professional follows up
//   green  — 2Q negative, or 9Q < 7: advise them to see health staff (รพ.สต.)

export const Q2 = [
  'ใน 2 สัปดาห์ที่ผ่านมารวมวันนี้ ท่านรู้สึก หดหู่ เศร้า หรือท้อแท้สิ้นหวังหรือไม่',
  'ใน 2 สัปดาห์ที่ผ่านมารวมวันนี้ ท่านรู้สึก เบื่อ ทำอะไรก็ไม่เพลิดเพลินหรือไม่',
];

export const Q9 = [
  'เบื่อ ไม่สนใจทำอะไร',
  'ไม่สบายใจ ซึมเศร้า ท้อแท้',
  'หลับยากหรือหลับ ๆ ตื่น ๆ หรือหลับมากไป',
  'เหนื่อยง่ายหรือไม่ค่อยมีแรง',
  'เบื่ออาหาร หรือกินมากเกินไป',
  'รู้สึกไม่ดีกับตัวเอง คิดว่าตัวเองล้มเหลว หรือทำให้ตนเองหรือครอบครัวผิดหวัง',
  'สมาธิไม่ดีเวลาทำอะไร เช่น ดูโทรทัศน์ ฟังวิทยุ หรือทำงานที่ต้องใช้ความตั้งใจ',
  'พูดช้า ทำอะไรช้าลง จนคนอื่นสังเกตเห็นได้ หรือกระสับกระส่ายไม่สามารถอยู่นิ่งได้เหมือนที่เคยเป็น',
  'คิดทำร้ายตนเอง หรือคิดว่าถ้าตายไปคงจะดี',
];

// Asked as "ใน 2 สัปดาห์ที่ผ่านมารวมวันนี้ ท่านมีอาการเหล่านี้บ่อยแค่ไหน"
export const Q9_SCALE = ['ไม่มีเลย', 'เป็นบางวัน (1–7 วัน)', 'เป็นบ่อย (>7 วัน)', 'เป็นทุกวัน'];

// `w` is the score for "มี". Item 3 has a follow-up asked only when item 3 is "มี".
export const Q8 = [
  { when: 'ช่วง 1 เดือนที่ผ่านมา', text: 'คิดอยากตาย หรือคิดว่าตายไปจะดีกว่า', w: 1 },
  { when: 'ช่วง 1 เดือนที่ผ่านมา', text: 'อยากทำร้ายตัวเอง หรือทำให้ตัวเองบาดเจ็บ', w: 2 },
  { when: 'ช่วง 1 เดือนที่ผ่านมา', text: 'คิดเกี่ยวกับการฆ่าตัวตาย', w: 6 },
  { when: 'ช่วง 1 เดือนที่ผ่านมา', text: 'มีแผนการที่จะฆ่าตัวตาย', w: 8 },
  { when: 'ช่วง 1 เดือนที่ผ่านมา', text: 'ได้เตรียมการที่จะทำร้ายตนเอง หรือเตรียมการจะฆ่าตัวตาย โดยตั้งใจว่าจะให้ตายจริง ๆ', w: 9 },
  { when: 'ช่วง 1 เดือนที่ผ่านมา', text: 'ได้ทำให้ตนเองบาดเจ็บ แต่ไม่ตั้งใจที่จะทำให้เสียชีวิต', w: 4 },
  { when: 'ช่วง 1 เดือนที่ผ่านมา', text: 'ได้พยายามฆ่าตัวตาย โดยคาดหวัง/ตั้งใจที่จะให้ตาย', w: 10 },
  { when: 'ตลอดชีวิตที่ผ่านมา', text: 'ท่านเคยพยายามฆ่าตัวตาย', w: 4 },
];
export const Q8_CONTROL = 'ท่านสามารถควบคุมความอยากฆ่าตัวตายที่ท่านคิดอยู่นั้นได้หรือไม่ หรือบอกได้ไหมว่าคงจะไม่ทำตามความคิดนั้นในขณะนี้';
export const Q8_CONTROL_W = 8; // "ไม่ได้"

export const Q9_BANDS = [[0, 'ไม่มีภาวะซึมเศร้า'], [7, 'ซึมเศร้าระดับน้อย'], [13, 'ซึมเศร้าระดับปานกลาง'], [19, 'ซึมเศร้าระดับรุนแรง']];
export const Q8_BANDS = [[0, 'ไม่มีแนวโน้มฆ่าตัวตาย'], [1, 'แนวโน้มฆ่าตัวตายระดับน้อย'], [9, 'แนวโน้มฆ่าตัวตายระดับปานกลาง'], [17, 'แนวโน้มฆ่าตัวตายระดับรุนแรง']];
const band = (bands, n) => bands.filter(([min]) => n >= min).pop()[1];

// What the volunteer does for each level (written for flood-affected residents).
export const MENTAL_ADVICE = {
  red: 'โทรขอความช่วยเหลือทันที อยู่กับผู้ประสบภัย อย่าปล่อยให้อยู่ลำพัง และเก็บของที่อาจใช้ทำร้ายตนเองให้พ้นมือ',
  yellow: 'ต้องให้ผู้เชี่ยวชาญด้านสุขภาพจิตติดตามเยี่ยม ระบบจะแจ้งทีมสุขภาพใจ แจ้งผู้ประสบภัยว่าจะมีผู้ติดต่อกลับ',
  green: 'แนะนำให้ไปพบเจ้าหน้าที่สาธารณสุขที่ รพ.สต. ใกล้บ้าน ให้กำลังใจ และแนะนำให้สังเกตอาการตนเอง ถ้าแย่ลงให้โทร 1323',
};

// Hotlines shown with a red result. Local numbers come from the server (EMERGENCY_CONTACTS in .env).
export const HOTLINES = [
  { label: 'เจ็บป่วยฉุกเฉิน', tel: '1669' },
  { label: 'สายด่วนสุขภาพจิต', tel: '1323' },
];

const isBool = (x) => x === true || x === false;
const isScore = (x) => Number.isInteger(x) && x >= 0 && x <= 3;

/** Keep only well-formed answers (used by the server before storing). */
export function cleanMental(m = {}) {
  const arr = (a, n, ok) => Array.from({ length: n }, (_, i) => (Array.isArray(a) && ok(a[i]) ? a[i] : null));
  return {
    q2: arr(m.q2, Q2.length, isBool),
    q9: arr(m.q9, Q9.length, isScore),
    q8: arr(m.q8, Q8.length, isBool),
    q8_control: isBool(m.q8_control) ? m.q8_control : null, // true = can control
  };
}

/**
 * Score a screening. `complete` is false while a required question is unanswered.
 * @returns {{complete:boolean, step:'q2'|'q9'|'q8'|'done', q2Positive:boolean|null, q9:number|null, q8:number|null,
 *   need9:boolean, need8:boolean, level:'red'|'yellow'|'green'|null, summary:string, flags:string[]}}
 */
export function scoreMental(input) {
  const m = cleanMental(input);
  const out = { complete: false, step: 'q2', q2Positive: null, q9: null, q8: null, need9: false, need8: false, level: null, summary: '', flags: [] };
  if (m.q2.some((x) => x == null)) return out;
  out.q2Positive = m.q2.some(Boolean);
  if (!out.q2Positive) {
    Object.assign(out, { complete: true, step: 'done', level: 'green', summary: '2Q ปกติ ไม่มีแนวโน้มซึมเศร้า' });
    return out;
  }
  out.need9 = true;
  out.step = 'q9';
  if (m.q9.some((x) => x == null)) return out;
  out.q9 = m.q9.reduce((s, x) => s + x, 0);
  out.need8 = out.q9 >= 7 || m.q9[8] > 0;
  let level = out.q9 >= 19 ? 'red' : out.q9 >= 7 ? 'yellow' : 'green';
  if (out.q9 >= 19) out.flags.push('9Q ≥ 19');
  const parts = [`9Q = ${out.q9} (${band(Q9_BANDS, out.q9)})`];
  if (out.need8) {
    out.step = 'q8';
    if (m.q8.some((x) => x == null) || (m.q8[2] && m.q8_control == null)) return out;
    out.q8 = Q8.reduce((s, q, i) => s + (m.q8[i] ? q.w : 0), 0) + (m.q8[2] && m.q8_control === false ? Q8_CONTROL_W : 0);
    parts.push(`8Q = ${out.q8} (${band(Q8_BANDS, out.q8)})`);
    if (out.q8 >= 9) out.flags.push('8Q ≥ 9');
    if (m.q8[2] && m.q8_control === false) out.flags.push('ควบคุมความคิดฆ่าตัวตายไม่ได้');
    if (m.q8[3]) out.flags.push('มีแผนฆ่าตัวตาย');
    if (m.q8[4]) out.flags.push('เตรียมการฆ่าตัวตาย');
    if (m.q8[6]) out.flags.push('พยายามฆ่าตัวตายใน 1 เดือน');
    if (out.flags.length) level = 'red';
    else if (out.q8 >= 1 && level === 'green') level = 'yellow';
  }
  Object.assign(out, { complete: true, step: 'done', level, summary: parts.join(' · ') });
  return out;
}
