# LabLoop

**Open Campus Labs:** a host college safely lends its idle makerspace, lab equipment and rooms to its own students and to verified students and startups from nearby institutions.

Every user is verified, every resource checks eligibility, high-demand equipment is shared by a rule anyone can read, and every hand-off leaves a tamper-evident record.

> All people, organisations and documents in the demo are fictional.

## Try it (judges)

1. Open **https://labloop-ierl.onrender.com** and pick a **"Try as…"** account on the sign-in page. Every password is `Demo@1234`.
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
8. **Admin** → the scheduler runs by itself every 10 minutes, so the seeded camera is already flagged **overdue** and both parties have been notified. *Run scheduler now* forces a pass → *Verify integrity* ✓.
9. Open any booking as either party: **Complete history** shows every step with its reason and hash.

## What's inside

| Need from the brief | Where |
|---|---|
| Listings with availability, location, rules, conditions | `/resources/[id]`, owner form `/resources/new` |
| Search / matching | Plain-language finder on `/` (`src/lib/finder.ts`) |
| Verification | External sign-up by partner domain + ID check; manager-verified credentials with expiry (`/me`, `/manage`) |
| Eligibility checks | `src/lib/booking.ts → precheck()`: identity, credentials, hours, length, advance window, quotas |
| Approve / reject / waitlist with reasons | Booking review panel; requests are waitlisted only when the approved request leaves too little inventory capacity |
| Cart, inventory and TTL holds | `/cart`; 12-minute database holds; `labloop_resource_peak` and a resource-row-locked trigger enforce unit capacity; `/api/cron/tick` expires holds |
| Combined booking requests | Cart submit creates one booking request group with a per-resource booking item for owner review |
| Conflicts | A serialized PostgreSQL capacity trigger prevents over-allocation across bookings and active cart holds, including simultaneous approvals |
| Fair use | Fair-Share Score (`src/lib/rules.ts`), weekly booking and hour caps, cooldown, 30% team cap, external-user share cap, waitlist offers |
| Trust ID and Trust Stars | `/me` displays a unique Trust ID, verification and training status, and a transparent score derived from returns, condition reports and incidents; owners see the same non-sensitive metrics during review |
| Check-in/out + Condition Vault | Checklist + photo at both ends, stored with the booking, shown only to the borrower and scoped department staff, and diffed side by side |
| Customer complaint tickets | Booking-linked issue types, evidence, timestamped message/status history, owner workflows, and optional AI summaries |
| Damage / delay / incidents | Incidents with human-decided outcomes and one appeal; scheduler flags overdue and no-shows |
| Notifications | In-app centre; scheduler reminders, overdue, offers |
| Roles | user, external, manager, owner, admin, scoped to departments (`canManage`) |
| Owner onboarding | Host users request access at `/owner-access`; an admin review grants the role and department with an audit entry |
| Audit | Append-only `audit_log`, SHA-256 hash chain computed by a DB trigger, *Verify integrity* button |
| Privacy | RLS on every table with no client policies; IDs/certificates visible only to verifiers; booking evidence and complaint histories visible only to booking participants and department staff |

## Architecture

Next.js (App Router, server components + server actions) on Render with PostgreSQL (plain SQL via `postgres`).
Every state change runs in one transaction: permission check → state-machine check → update → audit row → notification.
The scheduler (`/api/cron/tick`) can be called every 10 minutes by `pg_cron` with its secret in the database provider's secret vault, and from the admin button. It releases expired cart holds and offers freed capacity to eligible waitlisted requests.

```
src/lib/rules.ts     state machine + Fair-Share Score (pure, unit-tested)
src/lib/booking.ts   eligibility, capacity reads, quotas, waitlist offers
src/lib/trust.ts     private trust metrics and deterministic star calculation
src/app/actions/cart.ts   serialized cart holds and combined booking requests
src/lib/tick.ts      scheduler pass
src/app/actions/*    server actions (all writes)
db/migrations/       schema, constraints, audit chain
```

## Database and environment setup

LabLoop requires a real PostgreSQL database. It does not start PostgreSQL itself and does not fall back to sample data. `DATABASE_URL` is server-only; never prefix it with `NEXT_PUBLIC_`.

Create a private local environment file in Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Set `DATABASE_URL` to a valid PostgreSQL connection URL and set a unique `SESSION_SECRET`. Set `CRON_SECRET` for the protected cron route. `DEMO_MODE` enables the fictional demo flows. `.env.local` is ignored by Git; never paste real values into chat or commit them.

Run `npm.cmd run db:check` to test database connectivity and confirm the tables required by migrations `001`–`004` exist. This check does not change the database and never prints the connection URL. The project has no migration ledger or migration CLI, so it cannot infer which SQL migrations have already run.

Inspect the target database before applying any migration. Apply only missing SQL files, once each, in numeric order. Migration `002_app_role_and_scheduler.sql` contains password and cron-secret placeholders; never execute them literally. It also uses `pg_cron`, `pg_net`, and Vault, which may not be available on a plain PostgreSQL installation. Set the app-role password out of band, replace the cron-secret placeholder with the configured secret, and confirm the scheduler URL before applying it.

`npm run seed` truncates core LabLoop tables before inserting fictional demo data. Use it only on a fresh, disposable demo database, after applying migrations. It now requires both `DEMO_MODE=true` and `ALLOW_DEMO_SEED=true`.

Changing `.env.local` only affects the local server. Production requires the same required variables in the hosting service environment settings, followed by a restart or redeploy.

## Run locally

```powershell
npm.cmd install
npm.cmd run db:check
npm.cmd run dev
npm.cmd test
```

## Known limitations
- One host institution; partner organisations are users, not owners.
- Times are in IST only. Bookings are same-day ranges.
- Condition and complaint evidence are compressed and stored in Postgres; server pages enforce booking-participant and department access. Move evidence to private object storage before scaling.
- In demo mode, check-out is allowed before the start time so judges don't have to wait.

## Disclosure
Built during the hackathon window. Uses Next.js, React, Tailwind CSS, shadcn/ui (Radix), postgres.js, qrcode, date-fns and Vitest; hosted on Render and PostgreSQL. AI-assisted coding tools were used during development; details are in the submission document.
