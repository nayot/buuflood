import { Field, Check } from './ui.jsx';

/** Phone, LINE and email: at least one, or tick "no contact" (see shared/contact.js). */
export default function ContactFields({ v, set }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="โทรศัพท์"><input type="tel" inputMode="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field label="LINE ID"><input value={v.line} autoCapitalize="none" onChange={(e) => set({ line: e.target.value })} /></Field>
        <Field label="อีเมล"><input type="email" inputMode="email" autoCapitalize="none" value={v.email} onChange={(e) => set({ email: e.target.value })} /></Field>
      </div>
      <Check checked={v.no_contact} onChange={(on) => set({ no_contact: on })}>
        <b>ไม่มีช่องทางติดต่อ</b>
        <div className="text-sm text-neutral-500">เช่น ไม่มีโทรศัพท์ ระบุวิธีติดต่อแทนในหมายเหตุ (ญาติ เพื่อนบ้าน ผู้ใหญ่บ้าน)</div>
      </Check>
    </div>
  );
}
