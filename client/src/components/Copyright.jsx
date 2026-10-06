// Version and copyright line shown on the login screen, the guide and the menu.
export default function Copyright({ className = '' }) {
  return (
    <p className={`text-xs text-neutral-500 ${className}`}>
      BUU Flood v{__APP_VERSION__} · © 2026 Nayot Kurukitkoson · <a href="https://github.com/nayot/buuflood" target="_blank" rel="noreferrer" className="underline">MIT License</a>
    </p>
  );
}
