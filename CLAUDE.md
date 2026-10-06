# buuflood — notes for Claude

Triage web app for โครงการบูรพาร่วมฟื้นฟูหลังน้ำท่วม (Burapha University). Public repo, MIT. The UI is in **Thai**.
User-facing documentation is in README.md; this file covers conventions only.

- **Layout:** `server/` (Express 5, ESM), `client/` (React 19 + Vite + Tailwind 4), `shared/triage.js`
  (the questions, triage rules, labels and form constants, imported by both sides).
- **Change triage rules or questions only in `shared/triage.js`.** The server recomputes the level; the client
  only previews it.
- **URLs are relative everywhere** (`api/...`, `auth/...`, `print/...`). The client uses `base: './'` and hash routing,
  so the same build runs at `/` and behind nginx at `/buuflood/` (nginx strips the prefix). Never write a
  leading `/` in a client URL.
- **Storage:** `node:sqlite` (`server/db.js`, schema is `CREATE TABLE IF NOT EXISTS`; add columns with
  `ALTER TABLE` guarded by a check). Photos are in `DATA_DIR/uploads`.
- **Personal data:** the national ID and phone are encrypted with `encrypt()`/`decrypt()` (`server/crypto.js`) and stored only
  with consent. Responders get a masked ID. Never log them, never add real data or `.env` to the repo.
- **The print form** (`server/print.js`) mirrors the ปภ. paper form แบบคำร้องขอรับความช่วยเหลือผู้ประสบอุทกภัยในช่วงฤดูฝน
  (2568 edition, the reference image is in the FloodRecovery project docs). Check the layout against the current year's form.
- **Local testing:** `.env` with `DEV_AUTH=1`, then `/auth/dev?email=x@eng.buu.ac.th&role=responder&specialty=electrical`.
  DEV_AUTH is ignored when `NODE_ENV=production`. The test login redirects to `PUBLIC_URL`, so the session cookie lands
  on that host.
- **Phone testing:** GPS and the camera need HTTPS. Run `cloudflared tunnel --url http://localhost:5173` and set
  `PUBLIC_URL` to the tunnel address; `vite.config.js` already allows `*.trycloudflare.com`.
- **Demo data / screenshots:** run a second instance with its own `DATA_DIR` and `PORT` (for example 3001) and
  seed it through the API with fictional households. Never take screenshots from real data.
- **User guide:** `docs/USER_GUIDE.md` (Thai) is the single source. The client imports it with `?raw` (`pages/Guide.jsx`)
  and renders it at `#/guide`, the only page that works without signing in. Each `##` heading becomes a jump button.
  The Dockerfile copies `docs/` into the client build stage.
- **Outbox contract:** a 4xx response marks a queued visit as rejected and it is not retried; anything else is
  retried. So client mistakes, including upload errors (the multer handler in `server.js`), must return 4xx JSON,
  never a 500.
- **Header on phones:** it only has room for the title and the three buttons. The logo is shown from `sm:` up,
  and the 📍 label is icon-only on small screens.
- **Build check:** `npm --prefix client run build` and `docker build -t buuflood .`
- **Deployment:** eng-ai.buu.ac.th, container on `127.0.0.1:3011`, nginx include `nginx-buuflood.conf`.
- **Releases:** bump `version` in **both** `package.json` and `client/package.json` (the app shows the client one via
  `__APP_VERSION__`), add a `CHANGELOG.md` entry, commit, tag `vX.Y.Z`, push with tags, then `gh release create`.
