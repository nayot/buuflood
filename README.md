# BUU Flood Recovery — household triage app

**บูรพาร่วมฟื้นฟูหลังน้ำท่วม** · A mobile web app for Burapha University volunteers who visit flood-affected
households in the recovery phase. Volunteers record each household's needs; the app grades them
red / yellow / green, opens tickets for the right experts, and pre-fills the government relief form
(แบบคำร้องขอรับความช่วยเหลือผู้ประสบอุทกภัยในช่วงฤดูฝน) for the villager to sign.

The UI is in Thai. It works on any phone, tablet or laptop browser.

📖 **User guide (Thai): [docs/USER_GUIDE.md](docs/USER_GUIDE.md)** — for volunteers, responders, office staff and admins.

## How it works

```
Volunteer visits a house ──► needs checklist + GPS + photos ──► triage (red / yellow / green)
                                                                    │
     ┌──────────────────────────────────────────────────────────────┼────────────────────────┐
     ▼                                                              ▼                        ▼
 🟢 green: come to the service station          🟡/🔴 tickets for responders     🍚 food, water, clothes
 (อบต. / รพ.สต.)                                  (ไฟฟ้า, โครงสร้าง, สุขภาพกาย, สุขภาพใจ)   → office ticket
                                                  claim → navigate → update → close
 Office / อบต.: no-login print link (QR) → pre-filled relief form → villager signs and submits
```

| Role | Can do |
|---|---|
| `volunteer` (default on first login) | Record visits, see own visits, share location |
| `responder` + specialty | Tickets for their specialty plus every red ticket; claim, update, close, navigate |
| `office` | All visits, supply tickets, print links, dashboard |
| `admin` | Everything, plus assigning roles |

- **Sign-in:** Google, limited to `@go.buu.ac.th` and `@eng.buu.ac.th` (`ALLOWED_DOMAINS`).
- **Triage rules:** `shared/triage.js` — one file shared by the phone (live preview) and the server.
  Volunteers can override the level with a reason.
- **Weak signal:** visits are saved on the phone first (IndexedDB) and uploaded when there is signal.
  The server ignores a visit it already has, so retries never duplicate.
- **Locations:** shared while the app is open on screen (every 2 minutes, plus a 📍 button and every saved visit).
  Browsers, especially on iPhone, do not allow background location, so the map shows each person's
  *last* position and how long ago it was.
- **Relief form:** `/print/<token>` renders the form without login. The link is HMAC-signed and expires
  after `PRINT_LINK_DAYS` (14). Share it as a link or QR code with the อบต.

## Personal data (PDPA)

- Personal identifiers (national ID, phone) are stored **only if the villager consents**, and are
  encrypted at rest (AES-256-GCM, key `DATA_KEY`).
- Responders see the phone number (to call ahead) but only a masked ID. Full details are visible to the
  volunteer who collected them, office staff and admins.
- Delete household data when the project ends: `npm run purge -- --older-than 90` or `--all --yes`.
- This repository contains no real data. Never commit `.env` or `data/`.

## Local development

Requires Node.js 22.13+ (uses the built-in `node:sqlite`).

```bash
npm install && npm --prefix client install
cp .env.example .env      # set SESSION_SECRET, DATA_KEY, ADMIN_EMAILS; DEV_AUTH=1; PUBLIC_URL=http://localhost:5173
npm run dev               # server :3000 + Vite :5173
```

With `DEV_AUTH=1` (never in production) you can sign in without Google:
`http://localhost:5173/auth/dev?email=you@eng.buu.ac.th&role=responder&specialty=electrical`.

## Deployment (Docker + nginx)

1. Create a Google OAuth client (Web application) with redirect URI
   `https://eng-ai.buu.ac.th/buuflood/auth/callback`.
2. On the server:
   ```bash
   git clone https://github.com/<you>/buuflood && cd buuflood
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

## Stack

React 19 + Vite + Tailwind CSS 4 · Leaflet / OpenStreetMap · Express 5 · SQLite (`node:sqlite`) ·
Google OAuth (`google-auth-library`).

## License

MIT — see [LICENSE](LICENSE). Developed for โครงการบูรพาร่วมฟื้นฟูหลังน้ำท่วม, Burapha University.
