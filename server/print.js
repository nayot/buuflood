// Server-rendered, pre-filled แบบคำร้องขอรับความช่วยเหลือผู้ประสบอุทกภัยในช่วงฤดูฝน.
// Layout follows the ปภ. form (2568 edition). The villager signs the printed copy and submits it at the อปท.
import { RELIEF_CASES, RESIDENCE_TYPES, EVIDENCE } from '../shared/triage.js';

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function thaiDate(iso) {
  if (!iso) return { d: '', m: '', y: '' };
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return { d: '', m: '', y: '' };
  return { d: dt.getDate(), m: THAI_MONTHS[dt.getMonth()], y: dt.getFullYear() + 543 };
}

const box = (on) => `<span class="cb">${on ? '✓' : ''}</span>`;
const fill = (v, w = 8) => `<span class="fill" style="min-width:${w}em">${esc(v)}</span>`;

function idBoxes(id) {
  const digits = (id || '').replace(/\D/g, '').padEnd(13, ' ').split('');
  const groups = [1, 4, 5, 2, 1];
  let i = 0;
  return groups.map((n) => `<span class="idg">${digits.slice(i, (i += n)).map((c) => `<span class="idb">${c.trim()}</span>`).join('')}</span>`).join('');
}

export function renderForm(v, { photoUrl, year }) {
  const a = v.address || {};
  const today = thaiDate(new Date().toISOString());
  const from = thaiDate(v.flood_from);
  const to = thaiDate(v.flood_to);
  const ev = new Set(v.evidence || []);
  const photos = v.photos || [];

  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>แบบคำร้อง — ${esc(v.first_name)} ${esc(v.last_name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 14mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', sans-serif; font-size: 14.5px; line-height: 1.75; color: #000; margin: 0; background: #f2f2f2; }
  .page { width: 210mm; min-height: 297mm; margin: 12px auto; padding: 14mm 15mm; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.15); }
  .title { border: 1.5px solid #000; padding: 8px 12px; text-align: center; font-weight: 700; font-size: 17px; }
  .right { text-align: right; }
  h3 { font-size: 14.5px; margin: 10px 0 0; font-weight: 700; }
  .fill { display: inline-block; border-bottom: 1px dotted #000; padding: 0 4px; text-align: center; min-height: 1.4em; vertical-align: bottom; }
  .cb { display: inline-block; width: 14px; height: 14px; border: 1px solid #000; margin: 0 4px 0 0; text-align: center; line-height: 13px; font-size: 13px; font-weight: 700; vertical-align: -2px; }
  .idg { display: inline-block; margin-right: 6px; } .idb { display: inline-block; width: 16px; height: 20px; border: 1px solid #000; margin-left: -1px; text-align: center; line-height: 19px; font-weight: 700; }
  .case { margin: 2px 0 2px 2em; }
  .note { color: #b00; } .small { font-size: 13px; }
  .sig { margin-top: 18px; text-align: right; padding-right: 2em; }
  .officer { border-top: 2px solid #000; margin-top: 14px; padding-top: 6px; }
  .photos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
  .photos img { width: 100%; height: 80mm; object-fit: cover; border: 1px solid #999; }
  .bar { width: 210mm; margin: 12px auto 0; display: flex; gap: 8px; justify-content: flex-end; }
  .bar button { font: inherit; padding: 8px 18px; border-radius: 8px; border: 0; background: #3f3f3f; color: #fff; cursor: pointer; }
  @media print { body { background: #fff; } .page { margin: 0; box-shadow: none; padding: 0; width: auto; min-height: 0; } .bar { display: none; } .break { page-break-before: always; } }
</style></head><body>
<div class="bar"><button onclick="window.print()">พิมพ์แบบคำร้อง</button></div>
<div class="page">
  <div class="title">แบบคำร้องขอรับความช่วยเหลือผู้ประสบอุทกภัยในช่วงฤดูฝน ปี ${esc(year)}</div>
  <p class="right">วันที่${fill(today.d, 3)}เดือน${fill(today.m, 7)}พ.ศ.${fill(today.y, 5)}</p>

  <h3>ผู้ประสบอุทกภัย</h3>
  <div>คำนำหน้าชื่อ${fill(v.title, 4)} ชื่อ${fill(v.first_name, 12)} นามสกุล${fill(v.last_name, 12)}</div>
  <div>เลขประจำตัวประชาชน ${idBoxes(v.national_id)} อายุ${fill(v.age, 3)}ปี หมายเลขโทรศัพท์${fill(v.phone, 8)}</div>

  <h3>ประเภทที่อยู่อาศัยประจำที่ประสบอุทกภัย</h3>
  <div>${box(v.residence_type === 'registered')}${RESIDENCE_TYPES.registered} &nbsp; ${box(v.residence_type === 'rented')}${RESIDENCE_TYPES.rented} &nbsp; ${box(v.residence_type === 'other')}อื่น ๆ ระบุ${fill(v.residence_type === 'other' ? v.residence_other : '', 12)}</div>
  <div>ที่อยู่เลขที่${fill(a.house_no, 4)} หมู่บ้าน/คอนโด${fill(a.village, 8)} ชั้น${fill(a.floor, 2)} หมู่ที่/ชุมชน${fill(a.moo, 5)} ซอย${fill(a.soi, 6)}</div>
  <div>ถนน${fill(a.road, 7)} แขวง/ตำบล${fill(a.tambon, 8)} เขต/อำเภอ${fill(a.amphoe, 8)} จังหวัด${fill(a.province, 8)}</div>

  <h3>ได้รับผลกระทบจากสถานการณ์อุทกภัยน้ำท่วมขังที่อยู่อาศัยประจำ/ที่พักอาศัย</h3>
  <div><b>ตั้งแต่ วันที่</b>${fill(from.d, 3)}เดือน${fill(from.m, 6)}พ.ศ.${fill(from.y, 4)} <b>ถึงวันที่</b>${fill(to.d, 3)}เดือน${fill(to.m, 6)}พ.ศ.${fill(to.y, 4)}</div>

  <h3>การขอรับความช่วยเหลือ</h3>
  <div style="margin-left:1em">ที่อยู่อาศัยประจำ/ที่พักอาศัยในพื้นที่น้ำท่วมขัง</div>
  ${[1, 2, 3, 4].map((n) => `<div class="case">${box(Number(v.relief_case) === n)}กรณีที่ ${n} ${RELIEF_CASES[n]}${n === 1 ? ` ระบุ${fill(Number(v.relief_case) === 1 ? v.damage_desc : '', 16)}` : ''}</div>`).join('')}

  <div style="margin-top:6px"><b>PromptPay พร้อมเพย์ ที่ผูกบัญชีธนาคารกับ<u>เลขบัตรประจำตัวประชาชน</u></b> ${box(v.promptpay === 'yes')}มี &nbsp; ${box(v.promptpay === 'no')}ไม่มี</div>
  <div><b>หลักฐานที่นำมาในครั้งนี้</b> ${Object.entries(EVIDENCE).map(([k, l]) => `${box(ev.has(k))}${l}`).join(' &nbsp; ')}</div>
  <div><b>ขอรับรองว่าข้อความดังกล่าวเป็นความจริงทุกประการ</b></div>

  <div class="sig">ลงชื่อ${fill('', 14)}ผู้ยื่นคำร้อง/ผู้ประสบภัย<br>(${fill(`${v.title || ''}${v.first_name || ''} ${v.last_name || ''}`.trim(), 14)})</div>

  <p class="small"><b class="note"><u>หมายเหตุ</u></b> <span class="note">คำร้องจะสมบูรณ์เมื่อยื่นหลักฐานที่องค์กรปกครองส่วนท้องถิ่นในพื้นที่ที่ประสบภัยแล้ว เพื่อใช้ในการพิจารณาในขั้นตอนต่อไป</span><br>
  <b>คำเตือน</b> การให้ข้อมูลความอันเป็นเท็จ ย่อมมีความผิดตามประมวลกฎหมายอาญา มาตรา 137 มาตรา 267 และมาตรา 268</p>

  <div class="officer">
    <div style="text-align:center"><b>ส่วนนี้เฉพาะเจ้าหน้าที่</b></div>
    <div class="right">รับเอกสารเมื่อวันที่${fill('', 3)}เดือน${fill('', 6)}พ.ศ.${fill('', 4)}</div>
    <div>ตรวจสอบแล้วครบถ้วนถูกต้อง</div>
    <div class="sig">ลงชื่อ${fill('', 14)}เจ้าหน้าที่ผู้รับเรื่อง<br>ตำแหน่ง${fill('', 14)}<br>${fill('', 3)}/${fill('', 3)}/${fill('', 4)}</div>
  </div>
  <p class="small" style="color:#666;margin-top:10px">ข้อมูลเบื้องต้นกรอกโดยอาสาสมัครโครงการบูรพาร่วมฟื้นฟูหลังน้ำท่วม มหาวิทยาลัยบูรพา · โปรดตรวจสอบความถูกต้องก่อนลงนาม</p>
</div>
${photos.length ? `<div class="page break">
  <div class="title">เอกสารแนบ: ภาพถ่ายความเสียหาย</div>
  <p>ผู้ประสบอุทกภัย ${esc(`${v.title || ''}${v.first_name || ''} ${v.last_name || ''}`)} · ${esc([a.house_no && `เลขที่ ${a.house_no}`, a.moo && `หมู่ ${a.moo}`, a.tambon && `ต.${a.tambon}`, a.amphoe && `อ.${a.amphoe}`, a.province && `จ.${a.province}`].filter(Boolean).join(' '))}</p>
  <div class="photos">${photos.map((p) => `<img src="${photoUrl(p.id)}" alt="">`).join('')}</div>
</div>` : ''}
</body></html>`;
}

export function renderExpired() {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ลิงก์หมดอายุ</title></head><body style="font-family:sans-serif;padding:2em;text-align:center">
<h2>ลิงก์นี้หมดอายุหรือไม่ถูกต้อง</h2><p>กรุณาขอลิงก์ใหม่จากอาสาสมัครหรือศูนย์ช่วยเหลือ มหาวิทยาลัยบูรพา</p></body></html>`;
}
