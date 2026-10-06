import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

function ClickToPin({ onPick }) {
  useMapEvents({ click: (e) => onPick({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }) });
  return null;
}

function Recenter({ center }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView([center.lat, center.lng], Math.max(map.getZoom(), 14)); }, [center, map]);
  return null;
}

/** Tap the map to place the house pin. `center` moves the view (e.g. after looking up the address). */
export default function PinPicker({ pin, center, onPick }) {
  const start = pin || center || { lat: 12.66, lng: 102.03 };
  return (
    <div className="rounded-xl overflow-hidden border border-neutral-300">
      <MapContainer center={[start.lat, start.lng]} zoom={pin || center ? 14 : 11} style={{ height: 260 }} scrollWheelZoom={false}>
        <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Recenter center={center} />
        <ClickToPin onPick={onPick} />
        {pin && <CircleMarker center={[pin.lat, pin.lng]} radius={10} pathOptions={{ color: '#fff', weight: 3, fillColor: '#C0392B', fillOpacity: 1 }} />}
      </MapContainer>
    </div>
  );
}
