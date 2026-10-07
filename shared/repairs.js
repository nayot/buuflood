// Fixing Centre (ศูนย์ซ่อม): flood-damaged items brought in or listed during a home visit.
// Each item gets a queue number per type: prefix + running number, e.g. MC-001, FR-012.
// Changing a prefix renumbers nothing; existing items keep their stored type and sequence.

export const REPAIR_TYPES = {
  MC: 'รถจักรยานยนต์',
  CR: 'รถยนต์',
  FR: 'ตู้เย็น',
  WM: 'เครื่องซักผ้า',
  TV: 'โทรทัศน์',
  AC: 'เครื่องปรับอากาศ',
  FN: 'พัดลม',
  RC: 'หม้อหุงข้าว / เครื่องครัวไฟฟ้า',
  WP: 'ปั๊มน้ำ',
  PC: 'คอมพิวเตอร์ / โน้ตบุ๊ก',
  OT: 'อื่น ๆ',
};

export const REPAIR_STATUS = {
  registered: 'ลงทะเบียน (ยังอยู่ที่บ้าน)',
  received: 'รับเข้าศูนย์แล้ว',
  repairing: 'กำลังซ่อม',
  done: 'ซ่อมเสร็จ รอรับคืน',
  returned: 'ส่งคืนเจ้าของแล้ว',
  unfixable: 'ซ่อมไม่ได้',
};
export const REPAIR_CLOSED = ['returned', 'unfixable'];

export const ITEM_PHOTOS_MAX = 4;   // per item
export const ITEMS_MAX = 10;        // per visit or walk-in

export const queueNo = (type, seq) => `${type}-${String(seq).padStart(3, '0')}`;
