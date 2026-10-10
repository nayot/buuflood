# buuflood — notes for Claude

Triage web app for โครงการบูรพาร่วมฟื้นฟูหลังน้ำท่วม (Burapha University). Public repo, MIT. The UI is in **Thai**.
User-facing documentation is in README.md; this file covers conventions only.

- **Layout:** `server/` (Express 5, ESM), `client/` (React 19 + Vite + Tailwind 4), `shared/triage.js`
  (the questions, triage rules, labels and form constants, imported by both sides).
- **Change triage rules or questions only in `shared/`:** `triage.js` (needs and levels), `mental.js` (2Q/9Q/8Q
  wording and scoring, agreed with Nayot 8 Oct 2026), `repairs.js` (item types and prefixes), `contact.js` (contact
  rule). The server recomputes everything; the client only previews and must validate the same way.
- **URLs are relative everywhere** (`api/...`, `auth/...`). The client uses `base: './'` and hash routing,
  so the same build runs at `/` and behind nginx at `/buuflood/` (nginx strips the prefix). Never write a
  leading `/` in a client URL.
- **Storage:** `node:sqlite` (`server/db.js`, schema is `CREATE TABLE IF NOT EXISTS`; add columns with
  `ALTER TABLE` guarded by `hasColumn()` at the end of `db.js`). Photos are in `DATA_DIR/uploads`.
- **Admin test mode:** a sandbox database in `DATA_DIR/sandbox/` (same schema, own uploads, users copied with the same
  ids). The flag is `testUntil` in the signed session (8 h) and is honoured only for production admins. Request code uses
  the `db` proxy from `db.js`, which resolves per request (AsyncLocalStorage) and **throws outside a request** rather than
  falling back to production; background jobs and scripts use `prodDb` or `withDb()`. Multer callbacks lose the context,
  so uploads use `req.uploadDir` and the wrapped `upload`. Never prepare statements at module level. Guards against
  cross-mode writes: the outbox keeps a separate `outbox-test` key and every queued visit carries `test`; mutating API
  calls send `X-Test-Mode`; the server answers 409 on a mismatch, which the outbox treats as "keep".
- **LINE referral** (`server/line.js`, `shared/line.js`, `components/LineReferral.jsx`): yellow mental results only, with
  consent. Codes `BF-XXXXX` (`BT-` in test mode, which the webhook uses to pick the sandbox; it has no session). The form
  registers the code at once (`POST api/line-referrals`, the server rescores the answers); the saved visit is
  authoritative. Webhook `/line/webhook` (outside `/api`, signature over `req.rawBody`) replies with a greeting + brief, or
  the greeting only and pushes the brief when the visit arrives (push needs the villager to be a friend). Greetings are
  the nursing team's wording per screening case in `server/line-greetings.js` (verbatim, don't reword; no level yet =
  `unknown`). Never resend once
  `status = sent`. The mental ticket closes as `referred` only when the villager has sent the code. Contacts and the
  LINE user id are stored encrypted; the brief is rendered at send time. `LINE_API_BASE` points tests at a mock.
- **Volunteer phone:** `users.phone_enc` (encrypted), always read and written on `prodDb` (it is account data, not test
  data, and sandbox user rows don't copy it). `POST api/me/phone`; `/api/me`, `/api/users` and the visit's `creator` carry it.
- **Sign-in domains:** `ALLOWED_DOMAINS` (`/api/me` returns them to the login page). New accounts are volunteers.
- **Purging data:** `scripts/purge.js --all --yes` or `--older-than N` deletes visits (tickets, updates and photo rows
  cascade), photo files and (with `--all`) check-ins, and keeps users. In Docker: `docker compose exec app node scripts/purge.js …`.
- **Specialties:** `users.specialty` is a comma-separated list (`electrical,structural`). Always read it through
  `parseSpecialties()` in `shared/triage.js`, which drops invalid names. Responders see only tickets whose category's
  `specialty` is in their list (`ticketScope()` in `server.js`), at every level. Office staff see `basic`, `general`
  and every red ticket; admins see everything.
- **Location:** `visits.location_source` is `gps` (phone at the house) or `address` (met elsewhere: `lat`/`lng` is the
  optional map pin or null). Use `navLink()`/`placeLink()`/`canLocate()` from `client/src/lib/api.js`; they fall back to a
  Google Maps address search. The safety check-in uses the volunteer's own position (`here`), not the house.
  Address-only visits get `approx_lat`/`approx_lng`/`approx_level` from `server/geocode.js` (Nominatim, 1 req/s, no house
  number or name sent). They are for the dashboard map only; never use them for navigation.
- **Required on save:** the villager's first and last name; a contact or `no_contact` (`contactError()`); a complete
  2Q/9Q/8Q when a mental need is ticked; every item to repair with a type (walk-ins also 1–4 photos each; home visits take none); in `address` mode also
  `tambon`, `amphoe`, `province` and `house_no` or `moo`. The server returns 400 for missing ones, so validate the
  same fields in the client. A rule change that rejects what older phones queue strands their outbox: deploy such
  changes only when no phone shows "รอส่ง".
- **Personal data (v2):** name, address and contacts only. Phone, LINE and email are encrypted with
  `encrypt()`/`decrypt()` (`server/crypto.js`). The 1.x columns (national ID, title, age, residence, relief-form fields,
  consent) remain in old rows but are never read. Mental screening answers go only to admins, the creator and
  `mental` responders (`seesMentalDetail()` in `server.js`). Never log personal data, never add real data or `.env`.
- **Fixing Centre:** `server/repairs.js`. Only walk-ins (`POST /api/repairs`, online-only, deduplicated by
  `<request uuid>:<index>`) get a queue number (`type`-`seq`). Items listed in a home visit (section 5) are a survey of
  needs with no queue: stored as `visits.repair_needs` (JSON), their photos in `photos` with `item_uuid`; the owner
  registers at the centre. Item photos are multipart files named `item_<item uuid>` (multer `.any()`). Visits from
  2.0–2.2 may still have `repair_items` rows. Roles `fixer`, `office`, `admin` see the tab.
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
  and the 📍 label is icon-only on small screens. The version and copyright line is `components/Copyright.jsx`.
- **Emergency numbers:** 1669 and 1323 are in `shared/mental.js`; local ones come from `EMERGENCY_CONTACTS` via
  `/api/me` and are cached on the phone for offline use.
- **Build check:** `npm --prefix client run build` and `docker build -t buuflood .`
- **Deployment:** eng-ai.buu.ac.th, container on `127.0.0.1:3011`, nginx include `nginx-buuflood.conf`.
- **Releases:** bump `version` in **both** `package.json` and `client/package.json` (the app shows the client one via
  `__APP_VERSION__`), add a `CHANGELOG.md` entry, commit, tag `vX.Y.Z`, push with tags, then `gh release create`.
