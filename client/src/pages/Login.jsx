import { useState } from 'react';
import Copyright from '../components/Copyright.jsx';

const domainList = (domains) => {
  const list = (domains?.length ? domains : ['go.buu.ac.th', 'eng.buu.ac.th']).map((d) => `@${d}`);
  return list.length > 1 ? `${list.slice(0, -1).join(' ')} หรือ ${list.at(-1)}` : list[0];
};

export default function Login({ error, devAuth, domains }) {
  const ERRORS = { domain: `กรุณาใช้บัญชี ${domainList(domains)}`, oauth: 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่' };
  const [email, setEmail] = useState('nayot@eng.buu.ac.th');
  return (
    <div className="min-h-dvh grid place-items-center p-6 bg-ink">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center space-y-5 shadow-xl">
        <img src="buu-eng-logo.png" alt="มหาวิทยาลัยบูรพา คณะวิศวกรรมศาสตร์" className="h-12 mx-auto" />
        <div className="h-px bg-gold w-16 mx-auto" />
        <div>
          <h1 className="text-2xl font-bold">บูรพาร่วมฟื้นฟูหลังน้ำท่วม</h1>
          <p className="text-golddark font-semibold">BUU Flood Recovery</p>
          <p className="text-sm text-neutral-500 mt-2">ระบบคัดกรองความต้องการ สำหรับอาสาสมัครเยี่ยมบ้านและผู้เชี่ยวชาญ</p>
        </div>
        {error && <div className="rounded-xl bg-red-50 text-lvred p-3 text-sm">{ERRORS[error] || ERRORS.oauth}</div>}
        <a href="auth/login" className="btn-primary w-full">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          เข้าสู่ระบบด้วย Google
        </a>
        <p className="text-xs text-neutral-500">ใช้บัญชี {domainList(domains)}</p>
        <a href="#/guide" className="block text-sm text-golddark underline">📖 คู่มือการใช้งาน</a>
        {devAuth && (
          <form className="border-t pt-4 space-y-2 text-left" onSubmit={(e) => { e.preventDefault(); window.location.href = `auth/dev?email=${encodeURIComponent(email)}`; }}>
            <div className="text-xs font-bold text-lvred">โหมดทดสอบ (DEV_AUTH)</div>
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn-ghost w-full">เข้าสู่ระบบทดสอบ</button>
          </form>
        )}
        <Copyright className="pt-2" />
      </div>
    </div>
  );
}
