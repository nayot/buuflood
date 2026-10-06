import { useEffect, useState, useCallback } from 'react';
import { api } from './lib/api.js';
import { onOutboxChange, flush } from './lib/outbox.js';
import { getPosition } from './lib/device.js';
import { go } from './lib/nav.js';
import Login from './pages/Login.jsx';
import NewVisit from './pages/NewVisit.jsx';
import MyVisits from './pages/MyVisits.jsx';
import VisitDetail from './pages/VisitDetail.jsx';
import Tickets from './pages/Tickets.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Users from './pages/Users.jsx';
import Guide from './pages/Guide.jsx';
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

const ROLE_LABEL = { volunteer: 'อาสาสมัคร', responder: 'ผู้เชี่ยวชาญ', office: 'เจ้าหน้าที่', admin: 'ผู้ดูแลระบบ' };

function tabsFor(role) {
  const t = [{ to: '/new', label: 'เยี่ยมบ้าน', icon: '➕' }, { to: '/visits', label: 'บันทึก', icon: '📋' }];
  if (['responder', 'office', 'admin'].includes(role)) t.push({ to: '/tickets', label: 'งาน', icon: '🛠️', badge: true });
  if (['responder', 'office', 'admin'].includes(role)) t.push({ to: '/map', label: 'แผนที่', icon: '🗺️' });
  if (role === 'admin') t.push({ to: '/users', label: 'ผู้ใช้', icon: '👥' });
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
  const [outbox, setOutbox] = useState(0);
  const [openTickets, setOpenTickets] = useState(0);
  const [toast, setToast] = useState(null);
  const loc = useLocationSharing(me);

  const refreshMe = () => api('api/me').then((r) => { setMe(r.user); setDevAuth(!!r.devAuth); }).catch(() => setMe(null));
  useEffect(() => { refreshMe(); }, []);
  useEffect(() => onOutboxChange(setOutbox), []);
  useEffect(() => { if (me) flush(); }, [me]);

  const notify = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 3500); }, []);

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
  if (!me) return <Login error={query.get('error')} devAuth={devAuth} />;

  const tabs = tabsFor(me.role);
  const active = path === '/' ? (me.role === 'volunteer' ? '/new' : tabs.find((t) => t.to === '/tickets') ? '/tickets' : '/new') : path;

  let page;
  if (active === '/new') page = <NewVisit me={me} notify={notify} />;
  else if (active === '/visits') page = <MyVisits me={me} />;
  else if (active.startsWith('/visit/')) page = <VisitDetail id={active.split('/')[2]} me={me} notify={notify} />;
  else if (active === '/tickets') page = <Tickets me={me} notify={notify} onChange={(n) => setOpenTickets(n)} />;
  else if (active === '/map') page = <Dashboard me={me} />;
  else if (active === '/users' && me.role === 'admin') page = <Users me={me} notify={notify} />;
  else if (active === '/guide') page = <Guide section={query.get('s')} />;
  else page = <NewVisit me={me} notify={notify} />;

  const logout = async () => { await api('auth/logout', { method: 'POST' }); setMe(null); go('/'); };
  const checkinNow = () => loc.send().then(() => notify('ส่งตำแหน่งแล้ว')).catch((e) => notify(e.message));

  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-[1000] bg-ink text-white">
        <div className="mx-auto max-w-3xl px-4 py-2 flex items-center gap-3">
          <img src="buu-eng-logo.png" alt="BUU ENG" className="hidden sm:block h-9 rounded-md bg-white px-1.5 py-1 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-bold leading-tight truncate">บูรพาร่วมฟื้นฟู<span className="text-gold">หลังน้ำท่วม</span></div>
            <div className="text-xs text-neutral-300 truncate">{me.name} · {ROLE_LABEL[me.role]}</div>
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
              <a href="#/guide" className="block p-2 rounded-lg hover:bg-neutral-100">📖 คู่มือการใช้งาน</a>
              <div className="px-2 pb-2 text-xs text-neutral-500">{me.email}</div>
              <img src="buu-eng-logo.png" alt="มหาวิทยาลัยบูรพา คณะวิศวกรรมศาสตร์" className="h-8 mx-2 mb-2" />
              <button onClick={logout} className="w-full text-left p-2 rounded-lg hover:bg-neutral-100">ออกจากระบบ</button>
              <Copyright className="px-2 pt-2 border-t border-neutral-200" />
            </div>
          </details>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-3 sm:p-4">{page}</main>

      <nav className="fixed bottom-0 inset-x-0 z-[1000] bg-white border-t border-neutral-200 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-3xl grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((t) => (
            <a key={t.to} href={`#${t.to}`} className={`relative flex flex-col items-center py-2 text-xs ${active === t.to ? 'text-ink font-bold' : 'text-neutral-500'}`}>
              <span className="text-xl leading-none">{t.icon}</span>
              {t.label}
              {t.badge && openTickets > 0 && (
                <span className="absolute top-1 right-[22%] min-w-5 h-5 px-1 rounded-full bg-lvred text-white text-[11px] grid place-items-center">{openTickets}</span>
              )}
              {active === t.to && <span className="absolute top-0 inset-x-6 h-1 rounded-b bg-gold" />}
            </a>
          ))}
        </div>
      </nav>

      {toast && <div className="fixed bottom-24 inset-x-4 z-[1100] mx-auto max-w-sm rounded-xl bg-ink text-white px-4 py-3 text-center shadow-lg">{toast}</div>}
    </div>
  );
}
