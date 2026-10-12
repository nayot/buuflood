// Thai ID card scan for the Fixing Centre's walk-in form: a photo of the card front goes to a vision model on
// OpenRouter, which returns only the holder's name and address. The photo stays in memory and is dropped after the
// call; the ID number, birth date and face are never asked for, returned or stored. Off unless OPENROUTER_API_KEY is set.
import multer from 'multer';

const KEY = process.env.OPENROUTER_API_KEY || '';
const BASE = (process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
// First model, then the fallback OpenRouter tries if it fails (benchmarked on fictional cards, 12 Oct 2026).
const MODELS = (process.env.IDCARD_MODELS || 'google/gemini-3.5-flash-lite,google/gemini-3.8-flash').split(',').map((s) => s.trim()).filter(Boolean);
export const idcardEnabled = !!KEY;

const FIELDS = ['prefix', 'first_name', 'last_name', 'house_no', 'moo', 'tambon', 'amphoe', 'province'];
const PROMPT = 'This is a photo of the front of a Thai national ID card. Read ONLY the holder\'s name and address. '
  + 'Reply with JSON only, no other text: {"prefix":"","first_name":"","last_name":"","house_no":"","moo":"","tambon":"","amphoe":"","province":""} '
  + 'in Thai script as printed. prefix = นาย/นาง/นางสาว etc. moo = the number only. tambon/amphoe/province without ต./อ./จ. prefixes. '
  + 'Use "" for anything not visible. Do not include the ID number or birth date. '
  + 'If the photo is not a Thai ID card, reply {"not_card":true}.';

const strip = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
  .replace(/^(ตำบล|อำเภอ|จังหวัด|ต\.|อ\.|จ\.|หมู่ที่|ม\.)\s*/, '').slice(0, 100);

/** Keep only the expected fields; drop anything that looks like an ID number (13 digits) just in case. */
export function cleanCard(o) {
  if (!o || typeof o !== 'object' || o.not_card) return null;
  const out = Object.fromEntries(FIELDS.map((k) => [k, strip(o[k])]));
  for (const k of FIELDS) if (/\d[\d\s-]{11,}\d/.test(out[k])) out[k] = '';
  out.moo = out.moo.replace(/[^\d]/g, '').slice(0, 3);
  return out.first_name || out.last_name ? out : null;
}

const memory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)) }).single('photo');

// A scan per few seconds is plenty for a registration desk; this only stops runaway loops.
const recent = new Map();
const tooFast = (userId) => {
  const now = Date.now();
  const list = (recent.get(userId) || []).filter((t) => now - t < 60_000);
  list.push(now); recent.set(userId, list);
  return list.length > 20;
};

export function mountIdcard(router, { need, mod }) {
  const staff = (req, res, next) => (req.user?.repairStaff ? next() : res.status(403).json({ error: 'forbidden' }));
  router.post('/repairs/idcard', need(), mod('repairs'), staff, (req, res) => {
    if (!idcardEnabled) return res.status(503).json({ error: 'idcard off' });
    if (tooFast(req.user.id)) return res.status(429).json({ error: 'too many' });
    memory(req, res, async (err) => {
      if (err || !req.file) return res.status(400).json({ error: 'photo required' });
      const b64 = req.file.buffer.toString('base64');
      req.file.buffer = null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30_000);
      try {
        const r = await fetch(`${BASE}/chat/completions`, {
          method: 'POST', signal: ctrl.signal,
          headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'X-Title': 'BUU Flood' },
          body: JSON.stringify({
            models: MODELS, temperature: 0, max_tokens: 1500, reasoning: { effort: 'low' },
            // Only providers that neither keep nor train on the prompt.
            provider: { data_collection: 'deny' },
            messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: `data:${req.file.mimetype};base64,${b64}` } }] }],
          }),
        });
        if (!r.ok) {
          console.error('idcard: OpenRouter', r.status, (await r.text()).slice(0, 200));
          return res.status(502).json({ error: 'read failed' });
        }
        const j = await r.json();
        const m = String(j.choices?.[0]?.message?.content || '').match(/\{[\s\S]*\}/);
        let parsed = null;
        try { parsed = m && JSON.parse(m[0]); } catch { /* not JSON */ }
        const card = cleanCard(parsed);
        if (!card) return res.status(422).json({ error: 'not read' });
        res.json(card);
      } catch (e) {
        console.error('idcard:', e.name === 'AbortError' ? 'timeout' : e.message);
        res.status(502).json({ error: 'read failed' });
      } finally {
        clearTimeout(timer);
      }
    });
  });
}
