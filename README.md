# LabLoop

**Open Campus Labs:** a host college safely lends its idle makerspace, lab equipment and rooms to its own students and to verified students and startups from nearby institutions.

Every user is verified, every resource checks eligibility, high-demand equipment is shared by a rule anyone can read, and every hand-off leaves a tamper-evident record.

> All people, organisations and documents in the demo are fictional.

## Try it (judges)

1. Open the live URL and pick a **"Try as…"** account on the sign-in page. Every password is `Demo@1234`.
2. Follow the journey below. If the data gets messy, sign in as **Admin → Reset demo data**.

| Account | Role | Story |
|---|---|---|
| meera@rce.demo | External student (Riverside College) | ID not yet verified, missing training |
| aarav@nitf.demo | Host student | Has laser + 3D printing badges |
| rohan@nitf.demo | Heavy user | Lots of GPU hours, so loses fair-share ties |
| priya@kineticlabs.demo | Startup founder (verified external) | Competes with Aarav for the laser cutter |
| kavita@nitf.demo | Owner, Mechanical Makerspace | Lists resources, approves requests |
| sana@nitf.demo | Manager, Mechanical Makerspace | Verifies IDs and certificates, supervises, inspects |
| admin@nitf.demo | Admin | Scheduler, audit integrity, appeals, partners |

### Full journey (about 6 minutes)
1. **Owner (Kavita)** → Manage → *List a resource* (e.g. "Soldering Station", requires *Electrical Safety Level 1*).
2. **Meera** → search "solder a sensor board" → resource page shows ✗ identity and ✗ credential → *My passport*: upload an ID and a certificate (any photo).
3. **Manager (Sana)** → Manage → verify Meera's identity and certificate.
4. **Meera** → request a slot tomorrow.
5. **Kavita** → Manage → open the laser-cutter request: Aarav vs Priya ranked by **Fair-Share Score** → approve one → the other is **waitlisted automatically, with the reason**.
6. **Requester** → booking page → **check out** with checklist + photo (supervised items: Sana confirms).
7. **Return** with checklist + photo → **Sana** sees before/after side by side → *Pass and close* or *Open an incident* → resolve with an outcome (a person decides; the user can appeal once).
8. **Admin** → *Run scheduler now* (the seeded camera becomes **overdue**, notifications go out) → *Verify integrity* ✓.
9. Open any booking as either party: **Complete history** shows every step with its reason and hash.

## What's inside

| Need from the brief | Where |
|---|---|
| Listings with availability, location, rules, conditions | `/resources/[id]`, owner form `/resources/new` |
| Search / matching | Plain-language finder on `/` (`src/lib/finder.ts`) |
| Verification | External sign-up by partner domain + ID check; manager-verified credentials with expiry (`/me`, `/manage`) |
| Eligibility checks | `src/lib/booking.ts → precheck()`: identity, credentials, hours, length, advance window, quotas |
| Approve / reject / waitlist with reasons | Booking page review panel; overlapping requests are waitlisted automatically |
| Conflicts | Postgres exclusion constraint `no_overlap` makes double-booking impossible, even under races |
| Fair use | Fair-Share Score (`src/lib/rules.ts`), weekly hour caps, cooldown, 30% team cap, external-user share cap, waitlist offers |
| Check-in/out + condition | Checklist + photo at both ends, diffed side by side |
| Damage / delay / incidents | Incidents with human-decided outcomes and one appeal; scheduler flags overdue and no-shows |
| Notifications | In-app centre; scheduler reminders, overdue, offers |
| Roles | user, external, manager, owner, admin, scoped to departments (`canManage`) |
| Audit | Append-only `audit_log`, SHA-256 hash chain computed by a DB trigger, *Verify integrity* button |
| Privacy | RLS on every table with no client policies; IDs/certificates visible only to verifiers; purpose text only to staff |

## Architecture

Next.js (App Router, server components + server actions) on Vercel → Postgres on Supabase (plain SQL via `postgres`).
Every state change runs in one transaction: permission check → state-machine check → update → audit row → notification.
The scheduler (`/api/cron/tick`) runs from a GitHub Actions schedule and from the admin button.

```
src/lib/rules.ts     state machine + Fair-Share Score (pure, unit-tested)
src/lib/booking.ts   eligibility & quota checks, waitlist offers
src/lib/tick.ts      scheduler pass
src/app/actions/*    server actions (all writes)
db/migrations/       schema, constraints, audit chain
```

## Run locally

```bash
npm install
cp .env.example .env.local      # fill DATABASE_URL (Supabase transaction pooler), SESSION_SECRET, CRON_SECRET
# apply db/migrations/001_schema.sql to the database once
npm run seed                    # loads the fictional demo world
npm run dev
npm test                        # rules unit tests
```

## Known limitations
- One host institution; partner organisations are users, not owners.
- Times are in IST only. Bookings are same-day ranges.
- Photos are stored compressed in the database (fine for a pilot, move to object storage at scale).
- In demo mode, check-out is allowed before the start time so judges don't have to wait.

## Disclosure
Built during the hackathon window. Uses Next.js, React, Tailwind CSS, shadcn/ui (Radix), postgres.js, qrcode, date-fns and Vitest; hosted on Vercel and Supabase. AI-assisted coding tools were used during development; details are in the submission document.
