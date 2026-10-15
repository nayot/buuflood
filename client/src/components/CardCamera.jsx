import { useEffect, useRef, useState } from 'react';

// Live back camera for the ID card scan. Android in-app browsers (LINE, Facebook) and some vendor browsers ignore
// <input capture> and open the album, so Android phones take the photo here instead. Calls onShot(blob) or onFail().
export const liveCamera = () => /Android/i.test(navigator.userAgent) && !!navigator.mediaDevices?.getUserMedia;

export default function CardCamera({ onShot, onFail, onClose }) {
  const video = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stream, gone = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        video.current.srcObject = s;
        return video.current.play().then(() => setReady(true));
      })
      .catch(() => { if (!gone) onFail(); });
    return () => { gone = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shoot = () => {
    const v = video.current;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    canvas.toBlob((b) => b && onShot(b), 'image/jpeg', 0.92);
  };

  return (
    <div className="fixed inset-0 z-[2000] bg-black flex flex-col">
      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        <video ref={video} playsInline muted className="max-h-full max-w-full" />
        <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 aspect-[1.586] rounded-xl border-2 border-gold pointer-events-none" />
        {!ready && <p className="absolute text-white">กำลังเปิดกล้อง…</p>}
      </div>
      <p className="text-white text-center text-sm p-2">วางบัตรด้านหน้าให้เต็มกรอบ ไม่สะท้อนแสง</p>
      <div className="flex gap-2 p-3">
        <button type="button" onClick={onClose} className="btn-ghost flex-1 bg-white">ยกเลิก</button>
        <button type="button" onClick={shoot} disabled={!ready} className="btn-primary flex-1">📷 ถ่าย</button>
      </div>
    </div>
  );
}
