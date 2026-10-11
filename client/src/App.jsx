import { useEffect, useState, useCallback } from 'react';
import { api, setTestMode, setActivity, MODE_CHANGED, APP_CLOSED, ACTIVITY_GONE } from './lib/api.js';
import { onOutboxChange, flush, setOutboxMode, pendingIn, clearTestOutbox } from './lib/outbox.js';
import { SPECIALTIES } from '../../shared/triage.js';
import { getPosition } from './lib/device.js';
import { go } from './lib/nav.js';
import Login from './pages/Login.jsx';
import PhonePrompt from './components/PhonePrompt.jsx';
import Pending from './pages/Pending.jsx';
import Closed from './pages/Closed.jsx';
import Announce from './pages/Announce.jsx';
import { useAnnouncements, AnnouncementPopup } from './components/Announcement.jsx';
import NewVisit from './pages/NewVisit.jsx';
import MyVisits from './pages/MyVisits.jsx';
import VisitDetail from './pages/VisitDetail.jsx';
import Tickets from './pages/Tickets.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Users from './pages/Users.jsx';
import Guide from './pages/Guide.jsx';
import Repairs from './pages/Repairs.jsx';
import Activities from './pages/Activities.jsx';
import Join from './pages/Join.jsx';
import Members from './pages/Members.jsx';
import Summary from './pages/Summary.jsx';
import { ROLE_LABEL } from '../../shared/activities.js';
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

// Roles an admin or manager can try out in test mode ("responder:electrical" = responder with that one specialty).
const TEST_ROLES = [
  ['admin', ROLE_LABEL.admin], ['manager', 'ผู้จัดการกิจกรรม'], ['office', ROLE_LABEL.office], ['volunteer', ROLE_LABEL.volunteer], ['fixer', ROLE_LABEL.fixer],
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

const LEAD = ['admin', 'manager'];
const seesTickets = (role) => ['responder', 'office', ...LEAD].includes(role);

// The tabs follow the activity's modules and the member's role in it.
function tabsFor(me, act) {
  const t = [];
  const archived = act.status === 'archived';
  if (act.modules.includes('visits')) {
    if (!archived) t.push({ to: '/new', label: 'เยี่ยมบ้าน', icon: '➕' });
    t.push({ to: '/visits', label: 'บันทึก', icon: '📋' });
    if (seesTickets(me.role)) t.push({ to: '/tickets', label: 'งาน', icon: '🛠️', badge: !archived });
    if (seesTickets(me.role)) t.push({ to: '/map', label: 'แผนที่', icon: '🗺️' });
  }
  if (me.repair_staff && act.modules.includes('repairs')) t.push({ to: '/repairs', label: 'ศูนย์ซ่อม', icon: '🔧' });
  if (LEAD.includes(me.role)) t.push({ to: archived ? '/summary' : '/members', label: archived ? 'สรุป' : 'สมาชิก', icon: archived ? '📊' : '👥', pendingBadge: !archived });
  return t;
}

const ACT_KEY = 'activity';
const savedActivity = () => { try { return Number(localStorage.getItem(ACT_KEY)) || null; } catch { return null; } };
const saveActivity = (id) => { try { if (id) localStorage.setItem(ACT_KEY, String(id)); else localStorage.removeItem(ACT_KEY); } catch { /* private mode */ } };
const JOIN_KEY = 'join';

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
  const [account, setAccount] = useState(undefined); // the Google account (api/me)
  const [activities, setActivities] = useState([]);
  const [aid, setAid] = useState(savedActivity); // the activity on screen
  const [act, setAct] = useState(null); // its details and my role there (api/a/<id>/me)
  const [devAuth, setDevAuth] = useState(false);
  const [domains, setDomains] = useState(null);
  const [editPhone, setEditPhone] = useState(false);
  const [closed, setClosed] = useState(null); // { message, since, by } while an admin has switched the app off
  const [outbox, setOutbox] = useState(0);
  const [openTickets, setOpenTickets] = useState(0);
  const [toast, setToast] = useState(null);
  const test = act?.test || null; // { until } while test mode is on in this activity
  // What the pages call `me`: the account plus the role in the activity on screen.
  const me = account && act ? { ...account, role: act.role, specialty: act.specialty, specialties: act.specialties,
    repair_staff: act.repair_staff, line_oa: act.line_oa, pending_members: act.pending_members } : account && { ...account, role: null };
  const loc = useLocationSharing(account && act ? account : null);
  const ann = useAnnouncements(account);

  // A join link opened while signed out is remembered across the Google sign-in, then opened once (and forgotten,
  // whatever happens there, so a closed link can never trap anyone).
  useEffect(() => {
    if (account === null && path.startsWith('/join/')) { try { localStorage.setItem(JOIN_KEY, path.split('/')[2]); } catch { /* private mode */ } }
    if (account) {
      let t = null;
      try { t = localStorage.getItem(JOIN_KEY); localStorage.removeItem(JOIN_KEY); } catch { /* private mode */ }
      if (t && !path.startsWith('/join/')) window.location.hash = `#/join/${t}`;
    }
  }, [account?.id, account === null, path]);

  const refreshMe = () => api('api/me').then((r) => {
    setAccount(r.user); setActivities(r.activities || []); setClosed(r.closed || null); setDevAuth(!!r.devAuth);
    setDomains(r.domains ? { allowed: r.domains, approval: r.approval || [] } : null); rememberLocalContacts(r.emergency);
    if (r.user) {
      // Keep the activity on screen if still allowed (admins may open any, including archived ones); else the only one.
      const usable = (r.activities || []).filter((a) => a.role && a.role !== 'pending');
      const live = usable.filter((a) => a.status === 'live');
      setAid((cur) => {
        const next = cur && (r.user.realRole === 'admin' || usable.some((a) => a.id === cur)) ? cur : live.length === 1 ? live[0].id : null;
        saveActivity(next);
        return next;
      });
    }
  }).catch(() => setAccount(null));
  const refreshAct = useCallback(() => {
    if (!aid) { setActivity(null); setAct(null); setTestMode(false); setOutboxMode(false); return Promise.resolve(); }
    setActivity(aid);
    return api(`api/a/${aid}/me`).then((r) => {
      setAct({ ...r.activity, role: r.role, specialty: r.specialty, specialties: r.specialties, repair_staff: r.repair_staff,
        can_test: r.can_test, test: r.test, pending_members: r.pending_members, line_oa: r.line_oa });
      setTestMode(!!r.test); setOutboxMode(!!r.test);
    }).catch(() => { setAid(null); saveActivity(null); setAct(null); });
  }, [aid]);
  useEffect(() => { refreshMe(); }, []);
  useEffect(() => { if (account) refreshAct(); }, [account?.id, aid]);
  useEffect(() => onOutboxChange(setOutbox), []);
  useEffect(() => { if (account) flush(); }, [account?.id]);

  const pickActivity = (id, to = '/') => { saveActivity(id); setAct(null); setAid(id); window.location.hash = `#${to}`; };

  const notify = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 3500); }, []);

  // The server reports a mode change the screen has not seen (test mode expired or switched on another tab).
  useEffect(() => {
    const on = () => { notify('โหมดทดสอบเปลี่ยนแล้ว กำลังโหลดใหม่'); setTimeout(() => window.location.reload(), 1500); };
    window.addEventListener(MODE_CHANGED, on);
    return () => window.removeEventListener(MODE_CHANGED, on);
  }, [notify]);

  useEffect(() => {
    const on = () => refreshMe();
    window.addEventListener(APP_CLOSED, on);
    return () => window.removeEventListener(APP_CLOSED, on);
  }, []);

  // The activity was archived or this account left it: back to the list.
  useEffect(() => {
    const on = () => { refreshMe(); refreshAct(); };
    window.addEventListener(ACTIVITY_GONE, on);
    return () => window.removeEventListener(ACTIVITY_GONE, on);
  }, [refreshAct]);

  // New-ticket badge: poll while the app is open.
  useEffect(() => {
    if (!act || act.status !== 'live' || !act.modules.includes('visits') || !seesTickets(act.role)) return;
    const poll = () => api('api/tickets/count').then((r) => setOpenTickets(r.n || 0)).catch(() => {});
    poll();
    const t = setInterval(poll, 45000);
    return () => clearInterval(t);
  }, [act]);

  if (account === undefined) return <div className="p-8 text-center text-neutral-500">กำลังโหลด…</div>;
  if (!account && path === '/guide') return <Guide standalone section={query.get('s')} />;
  if (!account) return <Login error={query.get('error')} devAuth={devAuth} domains={domains} joining={path.startsWith('/join/')} />;
  const popup = <AnnouncementPopup a={ann.current} left={ann.left} onAck={ann.ack} />;
  const joined = (id) => { refreshMe(); if (account.realRole === 'pending') go('/'); else pickActivity(id); };
  const joinPage = (token) => <Join token={token} notify={notify} onJoined={joined} />;
  if (account.realRole === 'pending') {
    if (path.startsWith('/join/')) return <><div className="mx-auto max-w-sm p-4 pt-10 space-y-3">{joinPage(path.split('/')[2])}<a href="#/" className="block text-center text-sm text-golddark underline">กลับ</a></div>{popup}</>;
    return <><Pending me={account} activities={activities} onRefresh={refreshMe} />{popup}</>;
  }
  if (closed && account.realRole !== 'admin') return <><Closed me={account} closed={closed} outbox={outbox} onRefresh={refreshMe} />{popup}</>;

  const admin = account.realRole === 'admin';
  const ready = act && act.id === aid;
  const tabs = ready ? tabsFor(me, act) : [];
  const archived = ready && act.status === 'archived';
  const home = !ready ? '/activities' : archived ? (LEAD.includes(me.role) ? '/summary' : '/visits')
    : !act.modules.includes('visits') ? '/repairs' : me.role === 'fixer' && me.repair_staff ? '/repairs' : tabs.find((t) => t.to === '/tickets') ? '/tickets' : '/new';
  const active = path === '/' ? home : path;
  const lead = ready && LEAD.includes(me.role);
  const activitiesPage = <Activities me={account} activities={activities} current={aid} onPick={pickActivity} notify={notify} refreshMe={refreshMe} />;

  // Pages inside the activity on screen; null when the page does not exist for this role or activity.
  const activityPage = (p) => {
    if (p === '/new' && !archived && act.modules.includes('visits')) return <NewVisit me={me} notify={notify} refreshMe={refreshMe} />;
    if (p === '/visits') return <MyVisits me={me} archived={archived} />;
    if (p.startsWith('/visit/')) return <VisitDetail id={p.split('/')[2]} me={me} notify={notify} />;
    if (p === '/tickets' && seesTickets(me.role)) return <Tickets me={me} notify={notify} onChange={(n) => setOpenTickets(n)} />;
    if (p === '/map' && seesTickets(me.role)) return <Dashboard me={me} />;
    if (p === '/repairs' && me.repair_staff) return <Repairs notify={notify} view={query.get('view') || 'list'} />;
    if (p.startsWith('/repair/')) return <RepairDetail id={p.split('/')[2]} me={me} notify={notify} />;
    if (p === '/members' && lead) return <Members me={me} activity={act} notify={notify} refreshMe={refreshAct} />;
    if (p === '/summary' && lead) return <Summary me={me} activity={act} />;
    return null;
  };

  let page;
  if (active.startsWith('/join/')) page = joinPage(active.split('/')[2]);
  else if (active === '/activities') page = activitiesPage;
  else if (active === '/announce' && admin) page = <Announce notify={notify} />;
  else if (active === '/users' && admin) page = <Users me={account} notify={notify} refreshMe={refreshMe} />;
  else if (active === '/guide') page = <Guide section={query.get('s')} />;
  else if (aid && !ready) page = <div className="p-8 text-center text-neutral-500">กำลังโหลด…</div>;
  else page = (ready && (activityPage(active) || activityPage(home))) || activitiesPage;

  const logout = async () => { await api('auth/logout', { method: 'POST' }); setAccount(null); setAct(null); go('/'); };

  // Switching modes reloads the app, so no page keeps showing data from the other database.
  const reloadHome = () => { window.location.hash = '#/'; window.location.reload(); };
  const setTestOn = async (on) => {
    try {
      if (on) {
        await flush();
        const n = await pendingIn(false);
        if (n) return notify(`ยังมีบันทึกรอส่ง ${n} รายการ ส่งให้หมดก่อนเปิดโหมดทดสอบ`);
        if (!confirm(`เปิดโหมดทดสอบใน “${act.name}”? ทุกอย่างที่ทำจะบันทึกในฐานข้อมูลทดสอบของกิจกรรมนี้เท่านั้น ไม่เข้าข้อมูลจริง (ปิดเองใน 8 ชั่วโมง)`)) return;
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
  const setAppClosed = async (off) => {
    let message = '';
    if (off) {
      message = prompt('ปิดแอปสำหรับผู้ใช้ทุกคน (ยกเว้นผู้ดูแลระบบ)\nข้อความที่จะแสดง (เว้นว่างได้):', 'ปิดปรับปรุงระบบชั่วคราว');
      if (message === null) return;
    } else if (!confirm('เปิดแอปให้ผู้ใช้ทุกคนใช้งานได้ตามปกติ?')) return;
    try { const r = await api('api/app-closed', { method: 'POST', body: { closed: off, message } }); setClosed(r.closed || null); notify(off ? 'ปิดแอปแล้ว' : 'เปิดแอปแล้ว'); }
    catch (e) { notify(e.message); }
  };
  const checkinNow = () => loc.send().then(() => notify('ส่งตำแหน่งแล้ว')).catch((e) => notify(e.message));

  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-[1000] bg-ink text-white print:hidden">
        <div className="mx-auto max-w-3xl px-4 py-2 flex items-center gap-3">
          <img src="buu-eng-logo.png" alt="BUU ENG" className="hidden sm:block h-9 rounded-md bg-white px-1.5 py-1 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-bold leading-tight truncate">บูรพาร่วมฟื้นฟู<span className="text-gold">หลังน้ำท่วม</span></div>
            <a href="#/activities" className="block text-xs text-neutral-300 truncate">
              {ready ? <>{archived && '📦 '}{act.name} · {ROLE_LABEL[me.role]}{test ? ' (ทดสอบ)' : ''} ▾</> : <>{account.name} · เลือกกิจกรรม ▾</>}
            </a>
          </div>
          {outbox > 0 && (
            <button onClick={() => flush()} className="rounded-full bg-gold text-ink text-xs font-bold px-2.5 py-1" title="บันทึกที่ยังไม่ได้ส่ง">
              รอส่ง {outbox}
            </button>
          )}
          {ready && !archived && <button onClick={checkinNow} className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs" title="ส่งตำแหน่งปัจจุบัน (ฉันอยู่ที่นี่)">📍<span className="hidden sm:inline"> ฉันอยู่ที่นี่</span></button>}
          <a href="#/guide" className="shrink-0 rounded-full bg-white/10 w-8 h-8 grid place-items-center font-bold" title="คู่มือการใช้งาน">?</a>
          <details className="relative">
            <summary className="list-none cursor-pointer rounded-full bg-white/10 w-8 h-8 grid place-items-center">⋯</summary>
            <div className="absolute right-0 mt-2 w-60 rounded-xl bg-white text-ink shadow-lg p-2 text-sm">
              <a href="#/activities" className="block p-2 rounded-lg hover:bg-neutral-100">🗂️ กิจกรรม{ready ? <><br /><span className="text-xs text-neutral-500">{act.name}</span></> : ''}</a>
              {lead && <a href="#/summary" className="block p-2 rounded-lg hover:bg-neutral-100">📊 สรุปและส่งออกข้อมูล</a>}
              {lead && !archived && <a href="#/members" className="block p-2 rounded-lg hover:bg-neutral-100">👥 สมาชิกและลิงก์เข้าร่วม</a>}
              {ready && !archived && <label className="flex items-center gap-2 p-2">
                <input type="checkbox" checked={loc.sharing} onChange={loc.toggle} />
                <span>แชร์ตำแหน่งระหว่างปฏิบัติงาน<br /><span className="text-xs text-neutral-500">ส่งทุก 2 นาทีขณะเปิดแอปอยู่</span></span>
              </label>}
              {admin && (
                <button role="switch" aria-checked={!closed} onClick={() => setAppClosed(!closed)}
                  className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-neutral-100">
                  <span className="flex-1 text-left">🔌 แอป</span>
                  <span className={`text-xs font-bold ${closed ? 'text-lvred' : 'text-lvgreen'}`}>{closed ? 'ปิด' : 'เปิด'}</span>
                  <span className={`relative w-11 h-6 rounded-full transition-colors ${closed ? 'bg-neutral-300' : 'bg-lvgreen'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${closed ? '' : 'translate-x-5'}`} />
                  </span>
                </button>
              )}
              {ready && act.can_test && (
                <label className="flex items-center gap-2 p-2">
                  <input type="checkbox" checked={!!test} onChange={(e) => setTestOn(e.target.checked)} />
                  <span>🧪 โหมดทดสอบ<br /><span className="text-xs text-neutral-500">ลองใช้กิจกรรมนี้โดยไม่บันทึกเข้าข้อมูลจริง</span></span>
                </label>
              )}
              <button onClick={() => setEditPhone(true)} className="w-full text-left p-2 rounded-lg hover:bg-neutral-100">
                📞 เบอร์โทรของฉัน<br /><span className={`text-xs ${me.phone ? 'text-neutral-500' : 'text-lvred'}`}>{me.phone || 'ยังไม่ได้ใส่'}</span>
              </button>
              {admin && <a href="#/users" className="block p-2 rounded-lg hover:bg-neutral-100">🪪 บัญชีผู้ใช้{account.pending_users > 0 && <span className="ml-2 rounded-full bg-lvred text-white text-[11px] px-1.5">{account.pending_users}</span>}</a>}
              {admin && <a href="#/announce" className="block p-2 rounded-lg hover:bg-neutral-100">📢 ส่งประกาศ</a>}
              <a href="#/guide" className="block p-2 rounded-lg hover:bg-neutral-100">📖 คู่มือการใช้งาน</a>
              <div className="px-2 pb-2 text-xs text-neutral-500">{me.email}</div>
              <img src="buu-eng-logo.png" alt="มหาวิทยาลัยบูรพา คณะวิศวกรรมศาสตร์" className="h-8 mx-2 mb-2" />
              <button onClick={logout} className="w-full text-left p-2 rounded-lg hover:bg-neutral-100">ออกจากระบบ</button>
              <Copyright className="px-2 pt-2 border-t border-neutral-200" />
            </div>
          </details>
        </div>
        {closed && (
          <div className="bg-lvred text-white text-xs">
            <div className="mx-auto max-w-3xl px-4 py-1.5 flex items-center gap-2">
              <span className="flex-1 font-bold">🔌 แอปปิดอยู่: ผู้ใช้อื่นใช้งานไม่ได้{closed.message ? ` (“${closed.message}”)` : ''}</span>
              <button onClick={() => setAppClosed(false)} className="rounded-full bg-white text-lvred px-3 py-0.5 font-bold">เปิดแอป</button>
            </div>
          </div>
        )}
        {test && <TestBar me={me} test={test} onRole={setTestRole} onReset={resetTest} onOff={() => setTestOn(false)} />}
        {archived && (
          <div className="bg-neutral-600 text-white text-xs">
            <div className="mx-auto max-w-3xl px-4 py-1.5 font-bold">📦 กิจกรรมนี้เก็บถาวรแล้ว: ดูและดาวน์โหลดได้อย่างเดียว</div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-3xl p-3 sm:p-4">{page}</main>

      {tabs.length > 0 && <nav className="fixed bottom-0 inset-x-0 z-[1000] bg-white border-t border-neutral-200 pb-[env(safe-area-inset-bottom)] print:hidden">
        <div className="mx-auto max-w-3xl grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((t) => (
            <a key={t.to} href={`#${t.to}`} className={`relative flex flex-col items-center py-2 text-xs ${active === t.to ? 'text-ink font-bold' : 'text-neutral-500'}`}>
              <span className="text-xl leading-none">{t.icon}</span>
              {t.label}
              {t.badge && openTickets > 0 && (
                <span className="absolute top-1 right-[22%] min-w-5 h-5 px-1 rounded-full bg-lvred text-white text-[11px] grid place-items-center">{openTickets}</span>
              )}
              {t.pendingBadge && act.pending_members > 0 && (
                <span className="absolute top-1 right-[22%] min-w-5 h-5 px-1 rounded-full bg-lvred text-white text-[11px] grid place-items-center">{act.pending_members}</span>
              )}
              {active === t.to && <span className="absolute top-0 inset-x-6 h-1 rounded-b bg-gold" />}
            </a>
          ))}
        </div>
      </nav>}

      {popup}
      {editPhone && <PhonePrompt me={account} skipLabel="ยกเลิก" onSaved={refreshMe} onDone={(ok) => { setEditPhone(false); if (ok) notify('บันทึกเบอร์แล้ว'); }} />}
      {toast && <div className="fixed bottom-24 inset-x-4 z-[1100] mx-auto max-w-sm rounded-xl bg-ink text-white px-4 py-3 text-center shadow-lg">{toast}</div>}
    </div>
  );
}
