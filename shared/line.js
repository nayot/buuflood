// Referral codes for the BUU Flood Help LINE Official Account, shared by the phone and the server.
// BF-XXXXX for real visits, BT-XXXXX in the admin test mode. No 0/O or 1/I, so a code read aloud or typed is unambiguous.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newCode(test = false) {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `${test ? 'BT' : 'BF'}-${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}

/** Find a code in a chat message ("รหัสส่งต่อ bf-7k2q9", "BF 7K2Q9"…). Returns "BF-7K2Q9" or null. */
export function parseCode(text) {
  const m = String(text || '').toUpperCase().replace(/\s+/g, '').match(/B([FT])-?([A-HJ-NP-Z2-9]{5})/);
  return m ? `B${m[1]}-${m[2]}` : null;
}

/** Link that opens the OA chat with the code already typed in. The @ of the LINE ID must be encoded. */
export const oaMessageUrl = (oa, code) => `https://line.me/R/oaMessage/${encodeURIComponent(oa)}/?${encodeURIComponent(`รหัสส่งต่อ ${code}`)}`;

export const LEVEL_WORD = { red: 'ระดับแดง', yellow: 'ระดับเหลือง', green: 'ระดับเขียว' };

export const REFERRAL_STATUS = {
  waiting: 'รอผู้ประสบภัยส่งรหัสทาง LINE',
  linked: 'ผู้ประสบภัยเข้าแชทแล้ว รอส่งข้อมูล',
  sent: 'ส่งข้อมูลให้ผู้เชี่ยวชาญทาง LINE แล้ว',
  failed: 'ส่งข้อมูลทาง LINE ไม่สำเร็จ',
};
