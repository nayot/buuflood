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
- **Activities (3.0):** `node:sqlite` (`server/db.js`). `DATA_DIR/central.db` holds accounts (`users.role` =
  `user | admin | pending`), `activities` (modules JSON `visits`/`repairs`, `live | archived`, join token),
  `memberships` (role per activity: `manager | volunteer | responder | fixer | office | pending`, specialty), settings,
  announcements and `line_referrals`. Each activity has its own file `DATA_DIR/activities/<id>/buuflood.db` (+ `uploads/`,
  `sandbox/`) with the 2.x schema (`migrateActivity()`; add columns with `ALTER TABLE` guarded by `hasColumn()`).
  Archived files open **read-only** (`isReadOnly()`); `openForMaintenance()` is the only way to write one (archive,
  de-identify). The account is copied into the activity file on each request (`ensureUser()`) so joins on `users`
  still work; central ids are AUTOINCREMENT and never reused. Labels for modules and roles: `shared/activities.js`.
- **Activity routes:** everything about one activity is under `/api/a/:aid/…` (an Express router, `ar` in
  `server.js`; `repairs.js`, `line.js` and `activities.js` mount on it). `activityContext` checks membership (admins
  pass as role `admin`; archived activities only for admins and the activity's managers), picks the database and sets
  `req.activity`, `req.modules`, `req.user` (account + role in the activity + `repairStaff`), `req.test`. Writes to an
  archived activity answer **409 `archived`** (not 4xx-rejected: the outbox keeps the visit). Gate module routes with
  `mod('visits')`/`mod('repairs')` and lead pages with `need(...LEAD)` (`admin`, `manager`). Account-wide routes
  (`/api/me`, `/api/activities`, `/api/users`, `/api/join/:token`, announcements, app on/off) stay outside. On the
  client, `api()` prefixes every other `api/…` path with the activity on screen (`setActivity()`); use `aurl()` for
  `<img src>` and download links.
- **Test mode:** per activity, for admins and its managers: `req.session.test = { aid, until, role, specialty }` (8 h);
  data goes to the activity's `sandbox/`. Request code uses the `db` proxy from `db.js`, which resolves per request
  (AsyncLocalStorage) and **throws outside a request**; background jobs and scripts open a database explicitly
  (`activityDb(id)`, `sandboxDb(id)`). Multer callbacks lose the context, so uploads use `req.uploadDir` and the wrapped
  `upload`. Never prepare statements at module level. Guards against cross-mode writes: the outbox keeps a separate
  `outbox-test` key and every queued visit carries `test` and `activity`; mutating API calls send `X-Test-Mode`; the
  server answers 409 on a mismatch, which the outbox treats as "keep".
- **LINE referral** (`server/line.js`, `shared/line.js`, `components/LineReferral.jsx`): yellow mental results only, with
  consent. Codes `BF-XXXXX` (`BT-` in test mode). Referrals live in the **central** database with `activity_id`, `test`
  and the volunteer's name, because the webhook has no session; `markReferred()` opens that activity's file (or its
  sandbox) to close the ticket and skips archived ones. `referralConflict()` is checked before the visit transaction and
  `upsertReferral()` runs after COMMIT (two databases, no shared transaction). The form
  registers the code at once (`POST api/line-referrals`, the server rescores the answers); the saved visit is
  authoritative. Webhook `/line/webhook` (outside `/api`, signature over `req.rawBody`) replies with a greeting + brief, or
  the greeting only and pushes the brief when the visit arrives (push needs the villager to be a friend). Greetings are
  the nursing team's wording per screening case in `server/line-greetings.js` (verbatim, don't reword; no level yet =
  `unknown`). Never resend once
  `status = sent`. The mental ticket closes as `referred` only when the villager has sent the code. Contacts and the
  LINE user id are stored encrypted; the brief is rendered at send time. `LINE_API_BASE` points tests at a mock.
- **Volunteer phone:** `users.phone_enc` (encrypted), in the central database only (account data; activity files
  don't copy it). `POST api/me/phone`; `/api/me`, `/api/users` and the visit's `creator` carry it.
- **Sign-in domains:** `ALLOWED_DOMAINS` (`/api/me` returns them to the login page). New accounts are `user`, except
  those from `APPROVAL_DOMAINS` (`*` = any domain not in `ALLOWED_DOMAINS`), which start as `pending`: they can only use
  `/api/me`, `/api/me/phone`, `/api/join/:token` (joins as a `pending` member) and logout. A manager giving a pending
  member a role approves the account (`users.role` → `user`). Joining: `#/join/<token>`; the client remembers the token
  in localStorage across the Google sign-in.
- **App on/off:** `settings.app_closed` (JSON `{ message, since, by }`, central database, whole app), set by
  `POST api/app-closed` (real admins). A gate on `/api` answers **503** `closed` to non-admins (never 4xx: the outbox
  must keep queued visits); `/api/me` stays open and reports `closed`. The client shows `pages/Closed.jsx`.
- **Announcements:** `announcements` + `announcement_acks` (central database, to every account). The `/api` closed-app gate lets
  `/api/announcements/*` through; `pending` and `ack` work for any signed-in account, the rest is `realAdmin`. The client
  polls every 60 s and on visibilitychange (`components/Announcement.jsx`), remembering offline acks in localStorage.
- **Archive and purge:** archiving (admins, `POST /api/activities/:id/archive`) checkpoints the file, switches it to
  `journal_mode = DELETE`, reopens it read-only, closes the join link and deletes the sandbox. De-identify
  (`/deidentify`, archived only, confirm with the activity name) strips personal data and photos and keeps statistics.
  `scripts/purge.js --activity <id> --all --yes | --older-than N` deletes a live activity's visits (members kept).
- **Exports:** `server/activities.js`: `/admin/summary`, `/admin/export/{visits,tickets,repairs}.csv[?pii=1]` and
  `/admin/export/snapshot.db[?decrypt=1]` (`VACUUM INTO` a temp file under `DATA_DIR/tmp`, deleted after sending;
  decrypt is admin-only). Without `pii=1` CSVs carry no names, contacts, house numbers, positions, notes or 9Q/8Q.
- **2.x → 3.0 migration** (`migrateLegacy()` in `db.js`, runs once when `DATA_DIR/buuflood.db` exists and `central.db` has
  no activities): the old file and uploads become archived activity 1, admins are copied to `central.db` with the same
  ids, LINE referrals move to central, the 2.x sandbox is deleted.
- **Specialties:** `memberships.specialty` is a comma-separated list (`electrical,structural`). Always read it through
  `parseSpecialties()` in `shared/triage.js`, which drops invalid names. Responders see only tickets whose category's
  `specialty` is in their list (`ticketScope()` in `server.js`), at every level. Office staff see `basic`, `general`
  and every red ticket; admins and managers see everything in the activity.
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
  2.0–2.2 may still have `repair_items` rows. Roles `fixer`, `office`, `manager`, `admin` see the tab, and `volunteer` too when the activity has no `visits`
  module (`repairStaff()`). Queue numbers restart in each activity.
- **ID card scan** (`server/idcard.js`, `IdCardScan` in `pages/Repairs.jsx`): `POST /api/a/<id>/repairs/idcard`, one
  photo in memory (multer memoryStorage, never on disk) → OpenRouter `models` [first, fallback] with
  `provider.data_collection: 'deny'` → only name/address fields (`cleanCard()` drops 13-digit runs). Off without
  `OPENROUTER_API_KEY` (`/me` → `idcard`). Never store or log the photo, the ID number or the model's raw reply.
  **One item per person** (3.2): the scan turns a check-digit-valid ID number into `idCode(activityId, id)` (HMAC with
  `DATA_KEY`), returned as `id_code` with any earlier items; the walk-in stores it as `repair_items.owner_code`.
  `earlierItems()` matches by code, or by name (spaces ignored) when either side has no code. Leads (`admin`,
  `manager`) may send `override: { reason }`.
  Tests use a mock via `OPENROUTER_BASE`; never test with real cards.
- **Local testing:** `.env` with `DEV_AUTH=1`, then `/auth/dev?email=x@eng.buu.ac.th[&admin=1]` and, to join an activity,
  `&activity=2&role=responder&specialty=electrical`.
  DEV_AUTH is ignored when `NODE_ENV=production`. The test login redirects to `PUBLIC_URL`, so the session cookie lands
  on that host.
- **Phone testing:** GPS and the camera need HTTPS. Run `cloudflared tunnel --url http://localhost:5173` and set
  `PUBLIC_URL` to the tunnel address; `vite.config.js` already allows `*.trycloudflare.com`.
- **Demo data / screenshots:** run a second instance with its own `DATA_DIR` and `PORT` (for example 3001) and
  seed it through the API with fictional households. Never take screenshots from real data. Seeding scripts from 2.x
  (`api/visits`) need the `api/a/<id>/` prefix and a membership.
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
