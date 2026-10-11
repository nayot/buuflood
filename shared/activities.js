// Activities (กิจกรรม): modules and the roles a member can have in one. Used by the server and the client.

// What an activity offers. The tabs and the API follow the modules.
export const MODULES = {
  visits: { label: 'เยี่ยมบ้าน', detail: 'แบบบันทึกเยี่ยมบ้าน คัดกรอง งานของผู้เชี่ยวชาญ และแผนที่', icon: '🏠' },
  repairs: { label: 'ศูนย์ซ่อม', detail: 'รับเครื่องใช้ไฟฟ้า ออกเลขคิว ติดตามการซ่อม และรายงาน', icon: '🔧' },
};

// Roles inside one activity. Admins (an account role) act as `admin` in every activity.
export const ACTIVITY_ROLES = {
  pending: 'รออนุมัติ (ยังใช้งานไม่ได้)',
  volunteer: 'อาสาสมัคร',
  responder: 'ผู้เชี่ยวชาญ',
  fixer: 'ช่างซ่อม (ศูนย์ซ่อม)',
  office: 'เจ้าหน้าที่ (อบต./ศูนย์ช่วยเหลือ)',
  manager: 'ผู้จัดการกิจกรรม',
};

export const ROLE_LABEL = { ...ACTIVITY_ROLES, pending: 'รออนุมัติ', fixer: 'ช่างซ่อม', office: 'เจ้าหน้าที่', admin: 'ผู้ดูแลระบบ', user: 'ผู้ใช้' };
