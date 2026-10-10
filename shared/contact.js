// Contact details for a household or a repair-item owner: phone, LINE or email, at least one, unless the volunteer
// ticks "no contact" (the reason goes in the notes). Shared so the phone validates exactly like the server.

/** "ชื่อ นามสกุล (ชื่อเล่น)" for lists and headings; the nickname is optional. */
export const displayName = ({ first_name, last_name, nickname } = {}) => {
  const full = `${first_name || ''} ${last_name || ''}`.trim();
  return nickname ? (full ? `${full} (${nickname})` : nickname) : full;
};

export const cleanPhone = (p) => String(p || '').replace(/[^\d+]/g, '').slice(0, 16);
export const cleanLine = (l) => String(l || '').trim().replace(/\s+/g, '').slice(0, 50);
export const cleanEmail = (e) => String(e || '').trim().toLowerCase().slice(0, 120);

/** @returns {string|null} a Thai message for the volunteer, or null when the contact is acceptable. */
export function contactError({ phone, line, email, no_contact } = {}) {
  const p = cleanPhone(phone), l = cleanLine(line), e = cleanEmail(email);
  if (p && p.replace(/\D/g, '').length < 9) return 'เบอร์โทรศัพท์ไม่ครบ';
  if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return 'อีเมลไม่ถูกต้อง';
  if (!p && !l && !e && !no_contact) return 'กรุณากรอกช่องทางติดต่ออย่างน้อย 1 ช่อง (โทรศัพท์ LINE หรืออีเมล) หรือติ๊ก "ไม่มีช่องทางติดต่อ"';
  return null;
}
