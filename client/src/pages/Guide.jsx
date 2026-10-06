import { useEffect, useMemo } from 'react';
import { marked } from 'marked';
// Single source of truth: the same file is shown on GitHub.
import guide from '../../../docs/USER_GUIDE.md?raw';

// Section ids for the jump menu: "## อาสาสมัครเยี่ยมบ้าน" -> #g-อาสาสมัครเยี่ยมบ้าน
const slug = (t) => `g-${t.trim().replace(/\s+/g, '-')}`;

export default function Guide({ standalone, section }) {
  const { html, sections } = useMemo(() => {
    const sections = [];
    const renderer = new marked.Renderer();
    renderer.heading = ({ tokens, depth }) => {
      const text = tokens.map((t) => t.raw).join('');
      const inner = marked.parseInline(text);
      if (depth === 2) { sections.push(text); return `<h2 id="${slug(text)}">${inner}</h2>`; }
      return `<h${depth}>${inner}</h${depth}>`;
    };
    renderer.link = ({ href, text }) => `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;
    return { html: marked.parse(guide, { renderer }), sections };
  }, []);

  useEffect(() => {
    if (section) document.getElementById(slug(section))?.scrollIntoView();
  }, [section]);

  const jump = (s) => document.getElementById(slug(s))?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className={standalone ? 'min-h-dvh bg-neutral-100 p-3 sm:p-4' : ''}>
      <div className="mx-auto max-w-3xl space-y-3">
        {standalone && (
          <a href="#/" className="inline-flex items-center gap-1 text-sm text-golddark underline">← กลับไปหน้าเข้าสู่ระบบ</a>
        )}
        <nav className="card flex flex-wrap gap-2 text-sm">
          {sections.map((s) => (
            <button key={s} onClick={() => jump(s)} className="rounded-full bg-goldpale px-3 py-1">{s}</button>
          ))}
        </nav>
        <article className="card guide">
          <img src="buu-eng-logo.png" alt="มหาวิทยาลัยบูรพา คณะวิศวกรรมศาสตร์" className="h-10 mb-3" />
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </article>
      </div>
    </div>
  );
}
