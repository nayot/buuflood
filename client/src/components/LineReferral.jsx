import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { newCode, oaMessageUrl } from '../../../shared/line.js';
import { isTestMode } from '../lib/api.js';
import { Check } from './ui.jsx';

/**
 * Yellow mental result: hand the villager over to the BUU Flood Help LINE OA. The villager scans the QR code with
 * their own phone; it opens the OA chat with the referral code typed in, and they press send. The code is
 * registered with the server straight away (`register`), so the bot can answer with the brief as soon as it arrives.
 * `value`: null (not referred) or { code, consent }.
 */
export default function LineReferral({ oa, value, onChange, register }) {
  const [reg, setReg] = useState(null); // null | 'sending' | 'ok' | 'later'
  const on = !!value;
  const ready = on && value.consent && value.code;
  const url = ready ? oaMessageUrl(oa, value.code) : null;

  const svg = useMemo(() => {
    if (!url) return null;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
  }, [url]);

  useEffect(() => {
    if (!ready) { setReg(null); return; }
    let live = true;
    setReg('sending');
    register(value.code).then(() => live && setReg('ok')).catch(() => live && setReg('later'));
    return () => { live = false; };
  }, [ready, value?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rounded-xl border-2 border-[#06C755] bg-white p-3 space-y-2">
      <Check checked={on} onChange={(c) => onChange(c ? { code: null, consent: false } : null)}>
        <b>💬 ส่งต่อผู้เชี่ยวชาญทาง LINE (BUU Flood Help)</b>
        <div className="text-sm text-neutral-500">ผู้เชี่ยวชาญด้านสุขภาพใจจะคุยและดูแลต่อในแชท LINE ไม่ต้องรอทีมเยี่ยมบ้าน</div>
      </Check>
      {on && (
        <Check checked={value.consent} onChange={(c) => onChange({ code: c ? value.code || newCode(isTestMode()) : value.code, consent: c })}>
          <b>ผู้ประสบภัยยินยอม</b>
          <div className="text-sm text-neutral-500">
            ให้ส่งชื่อ ช่องทางติดต่อ พื้นที่ และผลคัดกรองสุขภาพใจไปยังแชท LINE ของ BUU Flood Help (ผู้ประสบภัยจะเห็นข้อมูลนี้ในแชทด้วย)
          </div>
        </Check>
      )}
      {ready && (
        <div className="space-y-2 text-center">
          <div className="mx-auto w-60 max-w-full rounded-lg bg-white" dangerouslySetInnerHTML={{ __html: svg }} />
          <ol className="text-sm text-left list-decimal pl-5 space-y-0.5">
            <li>ให้ผู้ประสบภัย<b>สแกน QR นี้ด้วยกล้องหรือ LINE ในโทรศัพท์ของตนเอง</b></li>
            <li>LINE จะเปิดแชท BUU Flood Help พร้อมข้อความรหัส ถ้ามีปุ่ม <b>เพิ่มเพื่อน</b> ให้กดก่อน</li>
            <li>กด <b>ส่ง</b> ระบบจะตอบกลับและส่งข้อมูลให้ผู้เชี่ยวชาญ</li>
          </ol>
          <div className="text-sm text-neutral-600">สแกนไม่ได้: เพิ่มเพื่อน <b>{oa}</b> แล้วพิมพ์รหัส</div>
          <div className="text-3xl font-bold tracking-widest">{value.code}</div>
          <div className={`text-xs ${reg === 'ok' ? 'text-lvgreen' : 'text-neutral-500'}`}>
            {reg === 'sending' ? 'กำลังลงทะเบียนรหัส…'
              : reg === 'ok' ? '✓ ลงทะเบียนรหัสแล้ว ส่งข้อมูลให้ผู้เชี่ยวชาญทันทีที่ผู้ประสบภัยกดส่ง'
                : 'ยังไม่มีสัญญาณ: รหัสใช้ได้ ข้อมูลจะส่งเมื่อบันทึกการเยี่ยมบ้านขึ้นระบบ'}
          </div>
        </div>
      )}
    </div>
  );
}
