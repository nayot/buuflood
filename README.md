# BUU Flood Recovery — household triage app

**บูรพาร่วมฟื้นฟูหลังน้ำท่วม** · A mobile web app for Burapha University volunteers who visit flood-affected
households in the recovery phase. Volunteers record each household's needs; the app grades them
red / yellow / green, screens for depression and suicide risk with the Department of Mental Health's 2Q/9Q/8Q,
opens tickets for the right experts, and queues flood-damaged items (motorbikes, fridges, washing machines…)
for the Fixing Centre (ศูนย์ซ่อม).

Work is organised in **activities** (กิจกรรม), e.g. "home visits in อ.แกลง" or "Fixing Centre in ต.โขมง". Several can run at
once; each has its own members, roles, modules and database, and is archived (read-only, still available for
analysis) when the work is handed over.

The UI is in Thai. It works on any phone, tablet or laptop browser.

📖 **User guide (Thai): [docs/USER_GUIDE.md](docs/USER_GUIDE.md)** — for volunteers, responders, office staff and admins.

## How it works

```
Volunteer visits a house ──► needs + 2Q/9Q/8Q + GPS/address ──► triage (red / yellow / green)
                                                                    │
     ┌──────────────────────────────────────────────────────────────┼────────────────────────┐
     ▼                                                              ▼                        ▼
 🟢 green: come to the service station          🟡/🔴 tickets for responders     🍚 food, water, clothes
 (อบต. / รพ.สต.)                                  (ไฟฟ้า, โครงสร้าง, สุขภาพกาย, สุขภาพใจ)   → office ticket
                                                  claim → navigate → update → close
 🔴 mental health: call buttons (1669, 1323, local numbers) shown at once
 🔧 damaged items + photos → queue number per type (MC-001, FR-001…) → Fixing Centre → report by type
```

Roles are per activity (`memberships`), except `admin`, which is an account role:

| Role | Can do |
|---|---|
| `volunteer` (default when joining) | Record visits, see own visits, share location; run the Fixing Centre when the activity has one |
| `responder` + one or more specialties | Tickets in their specialties only; claim, update, close, navigate |
| `fixer` | Fixing Centre: walk-in registration, item status, report and CSV |
| `office` | All visits, supply and other tickets, every red ticket, dashboard, Fixing Centre |
| `manager` | Everything in their own activity: members and roles, join link/QR, summary, CSV and SQLite exports, test mode |
| `admin` (account) | Every activity, live or archived; creates and archives activities; accounts, announcements, app on/off |

- **Activities:** an admin creates one with its modules — `visits` (visit form, screening, tickets, map) and/or
  `repairs` (Fixing Centre) — and the tabs follow. Volunteers join by the activity's link or QR code. Each activity's
  data is its own SQLite file, `DATA_DIR/activities/<id>/buuflood.db` (uploads and test sandbox alongside); accounts,
  activities, memberships, announcements and LINE referrals are in `DATA_DIR/central.db`. Archiving makes the file
  read-only; "ลบข้อมูลส่วนบุคคล" later strips names, contacts, house numbers, positions, notes, screening answers and
  photos, keeping the statistics.
- **Analysis:** per activity, live or archived: a summary page, CSV exports (with or without personal data) and a
  consistent SQLite snapshot (`VACUUM INTO`; admins may add decrypted contact columns). On the server the files can
  also be read directly (copy them out with `docker compose cp app:/app/data/activities/<id> .`).
- **Sign-in:** Google, limited to the domains in `ALLOWED_DOMAINS` (default `@go.buu.ac.th` and `@eng.buu.ac.th`; see
  below). Accounts from `APPROVAL_DOMAINS` wait as "รออนุมัติ" until an admin, or the manager of an activity they
  joined by link, approves them. `APPROVAL_DOMAINS=*` (the project's server) admits any other Google account that way.
- **Triage rules:** `shared/triage.js` — shared by the phone (live preview) and the server.
  Volunteers can override the level with a reason. The 2Q/9Q/8Q screening and its red/yellow/green rules are in
  `shared/mental.js`; it runs whenever a สุขภาพใจ need is ticked, and a red result shows tap-to-call numbers
  (`EMERGENCY_CONTACTS` in `.env` adds local ones).
- **Weak signal:** visits are saved on the phone first (IndexedDB) and uploaded when there is signal.
  The server ignores a visit it already has, so retries never duplicate.
- **Locations:** shared while the app is open on screen (every 2 minutes, plus a 📍 button and every saved visit).
  Browsers, especially on iPhone, do not allow background location, so the map shows each person's
  *last* position and how long ago it was.
- **Fixing Centre:** items come from home visits (each with at least one photo) or are registered as walk-ins at
  the centre. The queue number is the type prefix plus a running number per type (`shared/repairs.js`), issued by
  the server, so a visit saved offline gets its numbers when it uploads. The report groups items by type in queue
  order with the owner's contacts; print it or download CSV.
- **ID card scan (Fixing Centre walk-ins):** a photo of the owner's Thai ID card fills the name and address. The server
  passes it to a vision model on OpenRouter (`OPENROUTER_API_KEY`; models in `IDCARD_MODELS`) and keeps nothing; see
  `server/idcard.js`.
- **LINE referral:** a yellow mental-health result can be handed over to the BUU Flood Help LINE Official Account. The
  villager scans a QR code that opens the chat with a referral code; the bot replies there with a greeting written by the nursing team for that screening result, and a brief
  for the professional who takes over in LINE OA Manager. Needs `LINE_OA_ID`, `LINE_CHANNEL_SECRET` and
  `LINE_CHANNEL_ACCESS_TOKEN`, and the webhook `${PUBLIC_URL}/line/webhook`.
- **Test mode (admins and managers):** ⋯ menu → 🧪 โหมดทดสอบ, per activity. Everything done meanwhile goes to the
  activity's sandbox database (`DATA_DIR/activities/<id>/sandbox/`), never to the real data, with a role picker to try
  each role and a reset button. It switches itself off after 8 hours.

## Personal data (PDPA)

- Since 2.0 the app collects only the name, address and a contact (phone, LINE or email; at least one, or a
  "no contact" tick). Contacts are encrypted at rest (AES-256-GCM, key `DATA_KEY`). National IDs and the relief-form
  fields of 1.x visits stay in the database but are no longer shown; purge them when the project ends.
- The ID card scan sends the card photo to OpenRouter (providers that keep no data) and stores none of it; only the
  name and address fields the volunteer checks are saved, plus a keyed one-way code of the ID number (per activity) for
  the one-item-per-person rule. The number itself is never stored; de-identifying an archive clears the codes.
- The 2Q/9Q/8Q answers are health data: only admins, the volunteer who asked and mental-health responders see them.
  Others see the level and the totals.
- When an activity is over: archive it in the app, export what the follow-up needs, then remove its personal data
  ("ลบข้อมูลส่วนบุคคล" on the activities page) once follow-up is finished.
- Delete household data of a live activity (visits, tickets, photos, repair items, check-ins; members are kept).
  Back up first:
  ```bash
  docker compose cp app:/app/data ./backup-$(date +%F)
  docker compose exec app node scripts/purge.js --activity 2 --all --yes        # everything, e.g. after testing
  docker compose exec app node scripts/purge.js --activity 2 --older-than 90    # older than 90 days
  ```
  Outside Docker: `npm run purge -- --activity 2 --all --yes`. Make sure no phone still shows "รอส่ง", or those visits
  upload again.
- This repository contains no real data. Never commit `.env` or `data/`.

## Local development

Requires Node.js 22.13+ (uses the built-in `node:sqlite`).

```bash
npm install && npm --prefix client install
cp .env.example .env      # set SESSION_SECRET, DATA_KEY, ADMIN_EMAILS; DEV_AUTH=1; PUBLIC_URL=http://localhost:5173
npm run dev               # server :3000 + Vite :5173
```

With `DEV_AUTH=1` (never in production) you can sign in without Google:
`http://localhost:5173/auth/dev?email=you@eng.buu.ac.th&role=responder&specialty=electrical,structural`.

## Deployment (Docker + nginx)

1. Create a Google OAuth client (Web application) with redirect URI
   `https://eng-ai.buu.ac.th/buuflood/auth/callback`.
2. On the server:
   ```bash
   git clone https://github.com/nayot/buuflood && cd buuflood
   cp .env.example .env && nano .env      # fill in the OAuth client and secrets, NODE_ENV is set by compose
   docker compose up -d --build
   ```
   The container listens on `127.0.0.1:3011`. Data lives in the `data` volume
   (back it up with `docker compose cp app:/app/data ./backup`).
3. nginx: copy `nginx-buuflood.conf` to `/etc/nginx/includes/buuflood.conf`, include it in the
   `eng-ai.buu.ac.th` server block, then `sudo nginx -t && sudo nginx -s reload`.
   The `X-Forwarded-Proto` header is required: the session cookie is `secure`, and without that header
   the app can't tell it is behind HTTPS, so sign-in silently fails.

The client is built with a relative base and hash routing, so the same image works at any sub-path.

**Upgrading from 2.x to 3.0:** back up the volume first. On its first start 3.0 moves `buuflood.db` and `uploads/` to
`activities/1/` as an archived activity (name from `LEGACY_ACTIVITY_NAME`), keeps only admin accounts in the new
`central.db`, carries the LINE referrals over and deletes the 2.x test sandbox. Every visit stays in the archive.

## Stack

React 19 + Vite + Tailwind CSS 4 · Leaflet / OpenStreetMap · Express 5 · SQLite (`node:sqlite`) ·
Google OAuth (`google-auth-library`).

## License

MIT — see [LICENSE](LICENSE). Developed for โครงการบูรพาร่วมฟื้นฟูหลังน้ำท่วม, Burapha University.
