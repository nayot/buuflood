import { useEffect, useState, useCallback } from 'react';
import { api, setTestMode, MODE_CHANGED } from './lib/api.js';
import { onOutboxChange, flush, setOutboxMode, pendingIn, clearTestOutbox } from './lib/outbox.js';
import { SPECIALTIES } from '../../shared/triage.js';
import { getPosition } from './lib/device.js';
import { go } from './lib/nav.js';
import Login from './pages/Login.jsx';
import PhonePrompt from './components/PhonePrompt.jsx';
import Pending from './pages/Pending.jsx';
import NewVisit from './pages/NewVisit.jsx';
import MyVisits from './pages/MyVisits.jsx';
import VisitDetail from './pages/VisitDetail.jsx';
import Tickets from './pages/Tickets.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Users from './pages/Users.jsx';
import Guide from './pages/Guide.jsx';
import Repairs from './pages/Repairs.jsx';
import RepairDetail from './pages/RepairDetail.jsx';
import { rememberLocalContacts } from './components/Emergency.jsx';
import Copyright from './components/Copyright.jsx';

// Tiny hash router: #/path?query — works under any sub-path without server rewrites.
function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const [p, q] = (hash.replace(/^#/, '') || '/').split('?');
  return { path: p || '/', query: new URLSearchParams(q || '') };
}

const ROLE_LABEL = { pending: 'รออนุมัติ', volunteer: 'อาสาสมัคร', responder: 'ผู้เชี่ยวชาญ', fixer: 'ช่างซ่อม', office: 'เจ้าหน้าที่', admin: 'ผู้ดูแลระบบ' };

// Roles an admin can try out in test mode ("responder:electrical" = responder with that one specialty).
const TEST_ROLES = [
  ['admin', ROLE_LABEL.admin], ['office', ROLE_LABEL.office], ['volunteer', ROLE_LABEL.volunteer], ['fixer', ROLE_LABEL.fixer],
  ...Object.entries(SPECIALTIES).map(([k, label]) => [`responder:${k}`, `${ROLE_LABEL.responder} · ${label}`]),
];
const hhmm = (ms) => new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

// Admin test mode: a striped bar under the header for as long as it is on, so nobody records real houses in it.
function TestBar({ me, test, onRole, onReset, onOff }) {
  const value = me.role === 'responder' ? `responder:${me.specialties[0] || ''}` : me.role;
  return (
    <div className="bg-[repeating-linear-gradient(135deg,#f59e0b_0_12px,#fbbf24_12px_24px)] text-ink">
      <div className="mx-auto max-w-3xl px-4 py-1.5 space-y-1 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm flex-1">🧪 โหมดทดสอบ: ข้อมูลไม่ถูกบันทึกจริง</span>
          <button onClick={onOff} className="rounded-full bg-ink text-white px-3 py-0.5 font-bold">ปิด</button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label className="flex items-center gap-1">ทดสอบเป็น
            <select value={value} onChange={(e) => onRole(e.target.value)} className="w-auto! py-0.5! px-1! text-xs!">
              {TEST_ROLES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <span className="text-ink/70">ปิดเอง {hhmm(test.until)} น.</span>
          <button onClick={onReset} className="underline ml-auto">ล้างข้อมูล</button>
        </div>
      </div>
    </div>
  );
}

function tabsFor(role) {
  const t = [{ to: '/new', label: 'เยี่ยมบ้าน', icon: '➕' }, { to: '/visits', label: 'บันทึก', icon: '📋' }];
  if (['responder', 'office', 'admin'].includes(role)) t.push({ to: '/tickets', label: 'งาน', icon: '🛠️', badge: true });
  if (['responder', 'office', 'admin'].includes(role)) t.push({ to: '/map', label: 'แผนที่', icon: '🗺️' });
  if (['fixer', 'office', 'admin'].includes(role)) t.push({ to: '/repairs', label: 'ศูนย์ซ่อม', icon: '🔧' });
  if (role === 'admin') t.push({ to: '/users', label: 'ผู้ใช้', icon: '👥', pendingBadge: true });
  return t;
}

// Location sharing: positions are sent while the app is open on screen (browsers stop GPS in the background).
function useLocationSharing(user) {
  const [sharing, setSharing] = useState(() => { try { return localStorage.getItem('share') === '1'; } catch { return false; } });
  const [last, setLast] = useState(null);
  const send = useCallback(async () => {
    const p = await getPosition();
    await api('api/checkin', { method: 'POST', body: p });
    setLast(new Date());
    return p;
  }, []);
  useEffect(() => {
    if (!user || !sharing) return;
    const tick = () => { if (document.visibilityState === 'visible') send().catch(() => {}); };
    tick();
    const t = setInterval(tick, 2 * 60 * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [user, sharing, send]);
  const toggle = async () => {
    const next = !sharing;
    setSharing(next);
    try { localStorage.setItem('share', next ? '1' : '0'); } catch { /* private mode */ }
    if (!next) api('api/checkout', { method: 'POST' }).catch(() => {});
  };
  return { sharing, toggle, last, send };
}

export default function App() {
  const { path, query } = useHash();
  const [me, setMe] = useState(undefined);
  const [devAuth, setDevAuth] = useState(false);
  const [domains, setDomains] = useState(null);
  const [editPhone, setEditPhone] = useState(false);
  const [outbox, setOutbox] = useState(0);
  const [openTickets, setOpenTickets] = useState(0);
  const [toast, setToast] = useState(null);
  const [test, setTest] = useState(null); // { until } while the admin test mode is on
  const loc = useLocationSharing(me);

  const refreshMe = () => api('api/me').then((r) => {
    setTestMode(!!r.test); setOutboxMode(!!r.test); setTest(r.test || null);
    setMe(r.user); setDevAuth(!!r.devAuth); setDomains(r.domains || null); rememberLocalContacts(r.emergency);
  }).catch(() => setMe(null));
  useEffect(() => { refreshMe(); }, []);
  useEffect(() => onOutboxChange(setOutbox), []);
  useEffect(() => { if (me) flush(); }, [me]);

  const notify = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 3500); }, []);

  // The server reports a mode change the screen has not seen (test mode expired or switched on another tab).
  useEffect(() => {
    const on = () => { notify('โหมดทดสอบเปลี่ยนแล้ว กำลังโหลดใหม่'); setTimeout(() => window.location.reload(), 1500); };
    window.addEventListener(MODE_CHANGED, on);
    return () => window.removeEventListener(MODE_CHANGED, on);
  }, [notify]);

  // New-ticket badge: poll while the app is open.
  useEffect(() => {
    if (!me || !['responder', 'office', 'admin'].includes(me.role)) return;
    const poll = () => api('api/tickets/count').then((r) => setOpenTickets(r.n || 0)).catch(() => {});
    poll();
    const t = setInterval(poll, 45000);
    return () => clearInterval(t);
  }, [me]);

  if (me === undefined) return <div className="p-8 text-center text-neutral-500">กำลังโหลด…</div>;
  if (!me && path === '/guide') return <Guide standalone section={query.get('s')} />;
  if (!me) return <Login error={query.get('error')} devAuth={devAuth} domains={domains} />;
  if (me.realRole === 'pending') return <Pending me={me} onRefresh={refreshMe} />;

  const tabs = tabsFor(me.role);
  const home = me.role === 'fixer' ? '/repairs' : tabs.find((t) => t.to === '/tickets') ? '/tickets' : '/new';
  const active = path === '/' ? home : path;

  let page;
  if (active === '/new') page = <NewVisit me={me} notify={notify} refreshMe={refreshMe} />;
  else if (active === '/visits') page = <MyVisits me={me} />;
  else if (active.startsWith('/visit/')) page = <VisitDetail id={active.split('/')[2]} me={me} notify={notify} />;
  else if (active === '/tickets') page = <Tickets me={me} notify={notify} onChange={(n) => setOpenTickets(n)} />;
  else if (active === '/map') page = <Dashboard me={me} />;
  else if (active === '/repairs' && ['fixer', 'office', 'admin'].includes(me.role)) page = <Repairs notify={notify} view={query.get('view') || 'list'} />;
  else if (active.startsWith('/repair/')) page = <RepairDetail id={active.split('/')[2]} me={me} notify={notify} />;
  else if (active === '/users' && me.role === 'admin') page = <Users me={me} notify={notify} refreshMe={refreshMe} />;
  else if (active === '/guide') page = <Guide section={query.get('s')} />;
  else page = <NewVisit me={me} notify={notify} refreshMe={refreshMe} />;

  const logout = async () => { await api('auth/logout', { method: 'POST' }); setMe(null); go('/'); };

  // Switching modes reloads the app, so no page keeps showing data from the other database.
  const reloadHome = () => { window.location.hash = '#/'; window.location.reload(); };
  const setTestOn = async (on) => {
    try {
      if (on) {
        await flush();
        const n = await pendingIn(false);
        if (n) return notify(`ยังมีบันทึกรอส่ง ${n} รายการ ส่งให้หมดก่อนเปิดโหมดทดสอบ`);
        if (!confirm('เปิดโหมดทดสอบ? ทุกอย่างที่ทำจะบันทึกในฐานข้อมูลทดสอบเท่านั้น ไม่เข้าข้อมูลจริง (ปิดเองใน 8 ชั่วโมง)')) return;
      } else {
        const n = await pendingIn(true);
        if (n && !confirm(`มีบันทึกทดสอบที่ยังไม่ได้ส่ง ${n} รายการ จะถูกลบ ปิดโหมดทดสอบหรือไม่?`)) return;
        await clearTestOutbox();
      }
      await api('api/test-mode', { method: 'POST', body: { on } });
      reloadHome();
    } catch (e) { notify(e.message); }
  };
  const setTestRole = async (value) => {
    const [role, specialty] = value.split(':');
    try { await api('api/test-mode/role', { method: 'POST', body: { role, specialty } }); reloadHome(); } catch (e) { notify(e.message); }
  };
  const resetTest = async () => {
    if (!confirm('ล้างข้อมูลทดสอบทั้งหมด (บันทึก งาน สิ่งของซ่อม รูป) และบทบาทที่ตั้งไว้ในโหมดทดสอบ?')) return;
    try { await clearTestOutbox(); await api('api/test-mode/reset', { method: 'POST' }); reloadHome(); } catch (e) { notify(e.message); }
  };
  const checkinNow = () => loc.send().then(() => notify('ส่งตำแหน่งแล้ว')).catch((e) => notify(e.message));

  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-[1000] bg-ink text-white print:hidden">
        <div className="mx-auto max-w-3xl px-4 py-2 flex items-center gap-3">
          <img src="buu-eng-logo.png" alt="BUU ENG" className="hidden sm:block h-9 rounded-md bg-white px-1.5 py-1 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-bold leading-tight truncate">บูรพาร่วมฟื้นฟู<span className="text-gold">หลังน้ำท่วม</span></div>
            <div className="text-xs text-neutral-300 truncate">{me.name} · {ROLE_LABEL[me.role]}{test ? ' (ทดสอบ)' : ''}</div>
          </div>
          {outbox > 0 && (
            <button onClick={() => flush()} className="rounded-full bg-gold text-ink text-xs font-bold px-2.5 py-1" title="บันทึกที่ยังไม่ได้ส่ง">
              รอส่ง {outbox}
            </button>
          )}
          <button onClick={checkinNow} className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs" title="ส่งตำแหน่งปัจจุบัน (ฉันอยู่ที่นี่)">📍<span className="hidden sm:inline"> ฉันอยู่ที่นี่</span></button>
          <a href="#/guide" className="shrink-0 rounded-full bg-white/10 w-8 h-8 grid place-items-center font-bold" title="คู่มือการใช้งาน">?</a>
          <details className="relative">
            <summary className="list-none cursor-pointer rounded-full bg-white/10 w-8 h-8 grid place-items-center">⋯</summary>
            <div className="absolute right-0 mt-2 w-60 rounded-xl bg-white text-ink shadow-lg p-2 text-sm">
              <label className="flex items-center gap-2 p-2">
                <input type="checkbox" checked={loc.sharing} onChange={loc.toggle} />
                <span>แชร์ตำแหน่งระหว่างปฏิบัติงาน<br /><span className="text-xs text-neutral-500">ส่งทุก 2 นาทีขณะเปิดแอปอยู่</span></span>
              </label>
              {me.realRole === 'admin' && (
                <label className="flex items-center gap-2 p-2">
                  <input type="checkbox" checked={!!test} onChange={(e) => setTestOn(e.target.checked)} />
                  <span>🧪 โหมดทดสอบ<br /><span className="text-xs text-neutral-500">ลองใช้แอปโดยไม่บันทึกเข้าข้อมูลจริง</span></span>
                </label>
              )}
              <button onClick={() => setEditPhone(true)} className="w-full text-left p-2 rounded-lg hover:bg-neutral-100">
                📞 เบอร์โทรของฉัน<br /><span className={`text-xs ${me.phone ? 'text-neutral-500' : 'text-lvred'}`}>{me.phone || 'ยังไม่ได้ใส่'}</span>
              </button>
              <a href="#/guide" className="block p-2 rounded-lg hover:bg-neutral-100">📖 คู่มือการใช้งาน</a>
              <div className="px-2 pb-2 text-xs text-neutral-500">{me.email}</div>
              <img src="buu-eng-logo.png" alt="มหาวิทยาลัยบูรพา คณะวิศวกรรมศาสตร์" className="h-8 mx-2 mb-2" />
              <button onClick={logout} className="w-full text-left p-2 rounded-lg hover:bg-neutral-100">ออกจากระบบ</button>
              <Copyright className="px-2 pt-2 border-t border-neutral-200" />
            </div>
          </details>
        </div>
        {test && <TestBar me={me} test={test} onRole={setTestRole} onReset={resetTest} onOff={() => setTestOn(false)} />}
      </header>

      <main className="mx-auto max-w-3xl p-3 sm:p-4">{page}</main>

      <nav className="fixed bottom-0 inset-x-0 z-[1000] bg-white border-t border-neutral-200 pb-[env(safe-area-inset-bottom)] print:hidden">
        <div className="mx-auto max-w-3xl grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((t) => (
            <a key={t.to} href={`#${t.to}`} className={`relative flex flex-col items-center py-2 text-xs ${active === t.to ? 'text-ink font-bold' : 'text-neutral-500'}`}>
              <span className="text-xl leading-none">{t.icon}</span>
              {t.label}
              {t.badge && openTickets > 0 && (
                <span className="absolute top-1 right-[22%] min-w-5 h-5 px-1 rounded-full bg-lvred text-white text-[11px] grid place-items-center">{openTickets}</span>
              )}
              {t.pendingBadge && me.pending_users > 0 && (
                <span className="absolute top-1 right-[22%] min-w-5 h-5 px-1 rounded-full bg-lvred text-white text-[11px] grid place-items-center">{me.pending_users}</span>
              )}
              {active === t.to && <span className="absolute top-0 inset-x-6 h-1 rounded-b bg-gold" />}
            </a>
          ))}
        </div>
      </nav>

      {editPhone && <PhonePrompt me={me} skipLabel="ยกเลิก" onSaved={refreshMe} onDone={(ok) => { setEditPhone(false); if (ok) notify('บันทึกเบอร์แล้ว'); }} />}
      {toast && <div className="fixed bottom-24 inset-x-4 z-[1100] mx-auto max-w-sm rounded-xl bg-ink text-white px-4 py-3 text-center shadow-lg">{toast}</div>}
    </div>
  );
}
