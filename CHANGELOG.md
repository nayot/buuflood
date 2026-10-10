# Changelog

## 2.7.3 — 2026-10-10

- **Admins can switch the app off and on** (⋯ → 🔌 เปิดให้ผู้ใช้ใช้งานแอป, with an optional message). While it is off,
  everyone but admins sees "ระบบปิดชั่วคราว" with the message, and every API call except `/api/me` answers 503
  `closed`. Visits waiting on a phone stay there (the outbox retries 5xx) and are sent once the app is open again; the
  page says how many are waiting. Admins work as usual under a red "แอปปิดอยู่" bar with a เปิดแอป button. The LINE
  webhook keeps answering villagers. The switch is a row in the new `settings` table of the production database.

## 2.7.2 — 2026-10-10

- **The villager's nickname (ชื่อเล่น)**, optional, under the name in section 2 of a home visit (`visits.nickname`).
  Lists and headings show "ชื่อ นามสกุล (ชื่อเล่น)" (`displayName()` in `shared/contact.js`), and the jobs search finds it.
  Visits queued on phones before the update are accepted without one.

## 2.7.1 — 2026-10-10

- **`APPROVAL_DOMAINS=*` admits any Google account, with approval.** Accounts outside `ALLOWED_DOMAINS` start as
  "รออนุมัติ"; `@go.buu.ac.th` and `@eng.buu.ac.th` still start as volunteers. The login page says so.

## 2.7.0 — 2026-10-10

- **Accounts from `APPROVAL_DOMAINS` (gmail.com on the project's server) wait for an admin's approval.** They start as
  "รออนุมัติ" (`pending`), see a waiting screen where they can add their phone, and every other API call answers 403
  until an admin picks a role on the users page. Pending accounts are listed first with a red frame, and the 👥 tab
  shows how many are waiting (counted when the app loads). BUU accounts still start as volunteers.

## 2.6.0 — 2026-10-10

Requested in the field on the first volunteer day.

- **Jobs page (งาน): a search box and a count.** Search by name, address, phone, need or the name of whoever took the
  job (several words must all match). The count reads "12 งาน", or "แสดง 3 จาก 12 งาน" when a filter or search is on.
- **Volunteers' own phone numbers.** ⋯ → 📞 เบอร์โทรของฉัน. While none is saved, the app asks when a visit is saved
  (it can be skipped, e.g. without a signal, and asks again next time). The number is stored encrypted on the account
  (`users.phone_enc`) and shown on the visit (บันทึกโดย … 📞) and to admins on the users page (searchable).
- **The login page lists the allowed domains from the server** (`ALLOWED_DOMAINS`), so adding one, such as
  `gmail.com`, needs only the setting and a restart.

## 2.5.0 — 2026-10-10

Requested in the field on the first volunteer day.

- **The jobs page (งาน) can be filtered by need category** (ทุกด้าน, ⚡ ไฟฟ้า, 🏠 โครงสร้างบ้าน, …). The dropdown appears
  when the list holds more than one category, as it does for admins and office staff.
- **"ซ่อนงานที่คนอื่นรับแล้ว"** on the open jobs hides tickets someone else has claimed; your own and unclaimed ones
  stay. Each phone remembers the choice.
- Client only: no change to the server, the triage rules or the outbox.

## 2.4.0 — 2026-10-09

- **The LINE bot greets each villager with the nursing team's message for their screening result** (from
  "ข้อความตอบกลับอัตโนมัติใน Line official", Faculty of Nursing, 9 Oct 2026), instead of one welcome for everyone:
  - yellow with 8Q = 0 (9Q 7–18): "ทีม…จะทักกลับในแชทนี้ภายใน 24 ชั่วโมง" plus self-care while waiting;
  - yellow with 8Q 1–8: "จะติดต่อคุณโดยเร็วที่สุด อาจโทรไปตามเบอร์ที่ให้ไว้" plus staying with someone they trust;
  - code sent before the visit is uploaded (level not known yet): the general message for anyone asking for advice.
  The two red texts are stored too (`server/line-greetings.js`) but unused, because red results are not handed over
  to LINE. The brief that follows is unchanged. Referrals now also store the screening flags.

## 2.3.1 — 2026-10-08

- Section 5 of a home visit (สิ่งของที่ต้องซ่อม) no longer asks for photos: the volunteer records the type, brand and
  problem only. The Fixing Centre still photographs every item at walk-in registration. Photos sent by phones with
  older visits still waiting to upload are kept.

## 2.3.0 — 2026-10-08

- **Items to repair in a home visit are a survey of needs, not a queue.** Section 5 (สิ่งของที่ต้องซ่อม) still records
  the type, brand, problem and 1–4 photos of each item, but no queue number is issued and nothing goes into the Fixing
  Centre list. The form tells the volunteer to ask the owner to bring the item to the centre and register there. The
  visit page and the visit list show the items without a queue number.
  - Stored as `visits.repair_needs`, photos in `photos` with `item_uuid` (added automatically on start). Queue numbers
    are now issued only at the centre, so walk-ins no longer skip numbers taken by home visits.
  - **รับของที่ศูนย์** (walk-in registration with queue numbers), the list, status updates and the report are unchanged.
    Visits saved with 2.0–2.2 keep their Fixing Centre items and queue numbers.
  - Phones with visits still waiting to upload need no action: the request format is unchanged.
- User guide updated.

## 2.2.0 — 2026-10-08

- **LINE referral for yellow mental-health results.** With the villager's consent, the volunteer can hand them over to
  the BUU Flood Help LINE Official Account: the screen shows a QR code that opens the OA chat with a referral code
  (BF-XXXXX) typed in, and the villager presses send. The bot replies in that chat with a welcome (1323 / 1669 first)
  and a brief for the professional: name, contact, area, screening level and 9Q/8Q scores, volunteer and time.
  - The code is registered as soon as the volunteer ticks consent, so the bot can answer the moment it arrives (a
    reply, which also works before the villager adds the OA). With no signal, the bot welcomes the villager and pushes
    the brief when the visit is uploaded. A brief is never sent twice.
  - The สุขภาพใจ ticket closes as "ส่งต่อ" once the villager has sent the code; until then it stays open for the field
    team. The visit page shows the referral status.
  - Webhook `/line/webhook` with signature check. New settings: `LINE_OA_ID`, `LINE_CHANNEL_SECRET`,
    `LINE_CHANNEL_ACCESS_TOKEN` (the option is hidden until all three are set). Test-mode codes are BT- and stay in the
    sandbox. Contacts and the LINE user id are stored encrypted; `purge.js` removes referrals.
- User guide: how to hand a villager over to LINE.

## 2.1.0 — 2026-10-08

- **Admin test mode (โหมดทดสอบ):** admins can switch it on in the ⋯ menu to rehearse or demonstrate the app without
  touching the real data. Everything done meanwhile (visits, photos, tickets, repair items, check-ins, role changes)
  goes to a separate sandbox database in `DATA_DIR/sandbox/`, and the real data is not shown. An orange striped bar
  stays under the header while it is on, with a role picker (ทดสอบเป็น: volunteer, each responder specialty, fixer,
  office, admin), a reset button and the time it switches itself off (after 8 hours).
  - Isolation: the database is chosen per request and the code refuses to run a query when it cannot tell which one,
    rather than falling back to production. Test mode has its own outbox on the phone, every queued visit records its
    mode, and every change is sent with the mode the screen shows; the server answers 409 on a mismatch and the outbox
    keeps the visit instead of sending it to the other database.
  - Real visits still waiting to be sent must go first before test mode can be switched on; unsent test visits are
    dropped when it is switched off.
- **Visit form:** the sections now run ตำแหน่งบ้าน → ผู้ประสบภัยและช่องทางติดต่อ → ที่อยู่ → ความต้องการ. When
  "ไม่ได้พบที่บ้าน" is ticked, บ้านเลขที่ or หมู่, ตำบล, อำเภอ and จังหวัด are marked required and checked by the browser.
- **House photos removed** from the visit form (repair items still need theirs). The server still accepts them, so
  visits queued by 2.0.0 upload as before.
- `purge.js` deletes production data only; test data is cleared from the app.
- User guide: the new form order and a test-mode section for admins.

## 2.0.0 — 2026-10-08

Major release. **Deploy only when no phone shows "รอส่ง"**: visits queued by 1.x have no contact field and would be
rejected.

- **Relief form removed.** No more pre-filled แบบคำร้อง, print links or QR codes (`/print/*`, `server/print.js`,
  `PRINT_LINK_DAYS`, `FORM_YEAR`). The visit no longer asks for title, age, national ID, residence type or relief-form
  details. Those fields of 1.x visits stay in the database but are not shown.
- **Contact instead of ID:** first and last name plus at least one of phone, LINE ID or email (all encrypted), or a
  "ไม่มีช่องทางติดต่อ" tick with the alternative in the notes.
- **Mental-health screening (2Q 9Q 8Q, กรมสุขภาพจิต):** opens when any สุขภาพใจ need is ticked and must be completed.
  2Q positive → 9Q; 9Q ≥ 7 or item 9 > 0 → 8Q. Red: 8Q ≥ 9, or cannot control / plan / prepared / attempted, or
  9Q ≥ 19; yellow: 9Q 7–18 or 8Q 1–8; green otherwise. Red shows tap-to-call buttons for 1669, 1323 and local
  numbers (`EMERGENCY_CONTACTS`); yellow goes to the mental-health team; green advises seeing health staff.
  The answers are visible only to admins, the volunteer who asked and mental-health responders.
- **Fixing Centre (ศูนย์ซ่อม):** list damaged items during a visit (type, brand, problem, 1–4 photos each) or register
  walk-ins at the centre. Each item gets a queue number per type (MC-001, FR-001…). New tab and new `fixer` role
  (ช่างซ่อม): filters, search, status history, and a report by type in queue order with the owner's contacts,
  printable or as CSV. Volunteers see the queue numbers in their visits.
- Tickets show LINE and email, and mental-health tickets show the screening result.
- `purge.js` also deletes repair items and their photos.
- User guide rewritten for the new form, screening and Fixing Centre.

## 1.0.3 — 2026-10-07

- **Map shows households met away from home.** When a visit is recorded by address with no map pin, the server
  looks up an approximate position (village, then ตำบล, then อำเภอ) from OpenStreetMap Nominatim and the map plots it.
  Only the village, ตำบล, อำเภอ and จังหวัด are sent, never the house number or name. Existing visits are filled in at
  start-up and failed lookups are retried every 5 minutes. The estimate is kept apart from `lat`/`lng`, so navigation
  still uses the address or pin.
- **Marker outline shows where the position came from:** white = GPS at the house, purple = pinned by hand,
  purple dashed with a paler fill = estimated from the address. A legend is shown under the map, and visits sharing an
  estimated point are spread out so each can be tapped.
- User guide: the new map legend.

## 1.0.2 — 2026-10-07

- The Docker image now includes `scripts/`, so household data can be purged with
  `docker compose exec app node scripts/purge.js --all --yes` (user accounts are kept). README documents backup and purge.

## 1.0.1 — 2026-10-07

- **Several specialties per responder:** an admin can tick more than one area (for example ไฟฟ้า and โครงสร้างบ้าน).
  They're stored as a comma-separated list, and existing single specialties still work.
- **Responders see only tickets in their own specialties, at every level.** They no longer see red tickets from
  other areas; office staff and admins still see every red ticket. "Other needs" tickets now go to the office.
- The ticket list shows the responder's areas, or a warning if none are set.

## 1.0.0 — 2026-10-06

First release, for the field days in ต.โขมง อ.ท่าใหม่ จ.จันทบุรี (10–11 Oct 2026).

- **Home visits:** GPS location, needs checklist, live red / yellow / green triage with override and reason,
  consent-gated personal data (encrypted at rest), address, photos (compressed on the phone), relief-form details, notes.
- **Met away from home:** locate the house by its address instead of GPS, with an optional map pin.
  Directions fall back to an address search.
- **Name is required** for every visit.
- **Offline outbox:** visits are saved on the phone and uploaded when there is signal. Retries never duplicate.
- **Tickets** per specialty (electrical, structural, physical health, mental health) plus supplies for the office.
  Take a ticket, navigate, call, update status.
- **Dashboard:** map with triage dots, team positions and a list of visits without coordinates.
- **Relief form:** pre-filled แบบคำร้องขอรับความช่วยเหลือผู้ประสบอุทกภัยในช่วงฤดูฝน with the ปภ. logo, opened from a signed,
  expiring, no-login print link or QR code.
- **Roles:** volunteer, responder (with specialty), office, admin. Google sign-in limited to @go.buu.ac.th and @eng.buu.ac.th.
- **Thai user guide** in the app (the **?** button), also readable before signing in.
- Version and copyright line in the app.
