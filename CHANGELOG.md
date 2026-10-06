# Changelog

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
