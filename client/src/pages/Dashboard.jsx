import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, addressLine, timeAgo } from '../lib/api.js';
import { NEEDS, CATEGORIES, LEVEL_LABELS, SPECIALTIES } from '../../../shared/triage.js';
import { LEVEL_COLOR } from '../components/ui.jsx';

// Default view: BUU Chanthaburi Campus area (ต.โขมง อ.ท่าใหม่).
const CENTER = [12.66, 102.03];
const ROLE = { volunteer: 'อาสาสมัคร', responder: 'ผู้เชี่ยวชาญ', office: 'เจ้าหน้าที่', admin: 'ผู้ดูแลระบบ' };

const personIcon = L.divIcon({
  className: '',
  html: '<div style="width:26px;height:26px;border-radius:50%;background:#1d4ed8;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:grid;place-items:center;color:#fff;font-size:13px">👤</div>',
  iconSize: [26, 26], iconAnchor: [13, 13],
});

function FitBounds({ points }) {
  const map = useMap();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done || points.length === 0) return;
    map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 15 });
    setDone(true);
  }, [points, done, map]);
  return null;
}

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [levels, setLevels] = useState({ red: true, yellow: true, green: true });
  const [cat, setCat] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [showTeam, setShowTeam] = useState(true);

  useEffect(() => {
    const load = () => api('api/dashboard').then(setD).catch(() => setD({ visits: [], team: [], tickets: [] }));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const visits = useMemo(() => (d?.visits || []).filter((v) => v.lat != null
    && (!v.level || levels[v.level])
    && (!cat || v.needs.some((n) => NEEDS.find((x) => x.id === n)?.cat === cat))
    && (!openOnly || v.open > 0)), [d, levels, cat, openOnly]);

  const counts = useMemo(() => {
    const c = { red: 0, yellow: 0, green: 0, total: d?.visits.length || 0 };
    for (const v of d?.visits || []) if (v.level) c[v.level] += 1;
    return c;
  }, [d]);

  const openByCat = useMemo(() => {
    const o = {};
    for (const t of d?.tickets || []) if (!['done', 'referred'].includes(t.status)) o[t.category] = (o[t.category] || 0) + t.n;
    return o;
  }, [d]);

  if (!d) return <div className="card text-center py-10 text-neutral-500">กำลังโหลด…</div>;

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold px-1">ภาพรวม</h1>
      <div className="grid grid-cols-4 gap-2">
        <div className="card p-3 text-center"><div className="text-2xl font-bold">{counts.total}</div><div className="text-xs">ครัวเรือน</div></div>
        {['red', 'yellow', 'green'].map((l) => (
          <button key={l} onClick={() => setLevels((s) => ({ ...s, [l]: !s[l] }))}
            className={`card p-3 text-center border-2 ${levels[l] ? '' : 'opacity-40'}`} style={{ borderColor: LEVEL_COLOR[l] }}>
            <div className="text-2xl font-bold" style={{ color: LEVEL_COLOR[l] }}>{counts[l]}</div>
            <div className="text-xs">{LEVEL_LABELS[l].split(' · ')[0]}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-sm items-center">
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="w-auto py-1.5">
          <option value="">ทุกด้าน</option>
          {Object.entries(CATEGORIES).filter(([k]) => k !== 'general').map(([k, c]) => <option key={k} value={k}>{c.icon} {c.label}</option>)}
        </select>
        <label className="flex items-center gap-2"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />มีงานค้าง</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={showTeam} onChange={(e) => setShowTeam(e.target.checked)} />ทีม ({d.team.length})</label>
      </div>

      <div className="card p-0 overflow-hidden">
        <MapContainer center={CENTER} zoom={12} style={{ height: '60vh' }} scrollWheelZoom>
          <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitBounds points={visits.map((v) => [v.lat, v.lng])} />
          {visits.map((v) => (
            <CircleMarker key={v.id} center={[v.lat, v.lng]} radius={v.level === 'red' ? 10 : 8}
              pathOptions={{ color: '#fff', weight: 2, fillColor: LEVEL_COLOR[v.level] || '#888', fillOpacity: 0.95 }}>
              <Popup>
                <div className="text-sm">
                  <b>{LEVEL_LABELS[v.level] || 'ยังไม่คัดกรอง'}</b><br />
                  {addressLine(v.address)}<br />
                  {[...new Set(v.needs.map((n) => NEEDS.find((x) => x.id === n)?.cat))].filter(Boolean).map((c) => CATEGORIES[c].icon).join(' ')}
                  {' '}งานค้าง {v.open} · {timeAgo(v.created_at)}<br />
                  <a href={`#/visit/${v.id}`}>ดูรายละเอียด</a>
                </div>
              </Popup>
            </CircleMarker>
          ))}
          {showTeam && d.team.map((m, i) => (
            <Marker key={i} position={[m.lat, m.lng]} icon={personIcon}>
              <Popup><b>{m.name}</b><br />{ROLE[m.role]}{m.specialty ? ` (${SPECIALTIES[m.specialty] || m.specialty})` : ''}<br />อัปเดต {timeAgo(m.at)}</Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      <div className="card">
        <h2 className="font-bold mb-2">งานค้างตามด้าน</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          {Object.entries(CATEGORIES).map(([k, c]) => (
            <div key={k} className="flex justify-between rounded-lg bg-neutral-100 px-3 py-2"><span>{c.icon} {c.label}</span><b>{openByCat[k] || 0}</b></div>
          ))}
        </div>
      </div>

      {showTeam && d.team.length > 0 && (
        <div className="card">
          <h2 className="font-bold mb-2">ตำแหน่งทีมล่าสุด</h2>
          <ul className="text-sm divide-y">
            {d.team.map((m, i) => (
              <li key={i} className="py-1.5 flex justify-between gap-2">
                <span>{m.name} <span className="text-neutral-500">· {ROLE[m.role]}</span></span>
                <span className="text-neutral-500">{timeAgo(m.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
