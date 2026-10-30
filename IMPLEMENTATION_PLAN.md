# LabLoop: Implementation Plan (48-hour build)

> Read `decision.md` first for the *why*. This file is the *what* and *when*.
> Rule 2 of the hackathon: **plan now, write no product code until the build window opens.** Create the repo at H0 and commit often. The git history is our proof (rule 15).

---

## 1. Problem analysis: what the brief is really testing

**Surface ask:** a booking system for shared equipment.
**Real ask:** an **accountability layer for lending institutional property**. Owners lend only when four questions are answered:

| Owner's fear | Brief's words | Our answer |
|---|---|---|
| "Who is this person, and are they qualified?" | verification, qualifications, training | Credential Passport, manager-verified, with expiry |
| "Will they hog it?" | monopolisation, fair access | Hard quotas + Fair-Share Score + group caps + waitlist offers |
| "What state will it come back in?" | condition before/after, damage | Mandatory check-out/return checklists + photos + side-by-side diff |
| "If something goes wrong, can I prove what happened?" | auditable history, incidents | Hash-chained audit log + incident workflow + per-booking timeline |
| "Am I still in control?" | owners remain in control, human oversight | Owner approves; AI and rules only recommend; overrides need a reason |

**User's fears:** "Why was I rejected?" and "Is this fair?" → every decision carries a **visible reason**, and the score breakdown is visible.

**Traps that sink teams**
1. Pretty screens with a broken lifecycle. Criterion 3 says *"a broken core workflow will significantly affect the score."*
2. AI that auto-approves or auto-penalises. This violates rule 12 and the brief.
3. A judge who cannot get past login, or who has to wait for a timer → seeded accounts plus "Run scheduler now".
4. Real personal data in the demo (rule 10).
5. A demo link that dies during judging (rule 18). Free-tier Supabase projects **pause after inactivity**, so ping it daily, or upgrade for the judging week.

---

## 2. Scope (MoSCoW, mapped to criteria)

### P0: the walking skeleton. Must be complete at H20 or nothing else starts
| # | Feature | Lifecycle step |
|---|---|---|
| 1 | Auth + seeded demo accounts + "Try as…" buttons | — |
| 1b | External sign-up (partner email domain) → ID upload → manager verifies identity; browse-only until verified | 4 |
| 2 | Owner creates/edits a resource: details, location, photos, rules, required credentials, opening hours, max duration, turnaround, supervision flag, deposit note, high-demand flag | 1 |
| 3 | Catalog with search + filters (category, dept, location, "I'm eligible") | 2 |
| 4 | Resource page: availability grid + eligibility checklist (✅/❌ + how to fix) + rules | 2 |
| 5 | Booking request: slot, purpose category, purpose text, team code; quota precheck shown inline | 3, 4 |
| 6 | Owner review queue: requester credential status, conflicts, Fair-Share breakdown; Approve / Reject / Waitlist, each with a reason | 5, 6 |
| 7 | Check-out: checklist + photo + (supervised → manager confirms) | 7 |
| 8 | Return: checklist + photo; manager inspects → Close or raise incident | 8 |
| 9 | Audit log write on every transition + per-booking timeline | 10 |
| 10 | In-app notifications | — |

### P1: what makes it *win* (H20–H38)
| Feature | Criterion |
|---|---|
| DB exclusion constraint + conflict warnings | Technical 15, Core 20 |
| Fair-Share Score + quotas + group cap + internal/external population split + waitlist offers | Fairness 10 |
| Credential upload → manager verify/reject | Trust 10 |
| Incidents (damage/delay/conflict/misuse/safety) + penalties + appeal | Trust 10 |
| Scheduler: reminders, overdue, no-show, offer expiry + "Run now" button | Core / Notifications |
| Cancellation (user) + extension request (user → owner approves if no conflict) | Brief list |
| QR code per resource → `/r/[qrToken]` opens check-out/return on a phone | Originality |
| Hash-chain verify button | Technical / Trust |
| AI: natural-language finder, credential check, condition diff (with fallbacks) | Originality |
| Judge Mode checklist + Reset demo data | E2E 20 |
| Admin: policies editor, users and roles, disputes, rule-based suspicious-usage flags | Roles |
| Email via Resend | Notifications |

### P2: only if ahead of schedule
Owner analytics (utilisation %, idle hours unlocked, fairness distribution / Gini) · request-window batch allocation · partner self-service portal (partner coordinator endorses their own students) · calendar `.ics` export · dark mode.

---

## 3. Architecture

```
Browser (Next.js RSC + client components, shadcn/ui)
   │  server actions / route handlers only (no direct DB from the client)
   ▼
Next.js server (Vercel)
   ├── lib/auth        – Supabase session → actor {id, role, deptIds}
   ├── lib/authorize   – can(actor, action, entity)        ← single source of permissions
   ├── lib/booking     – transitions.ts (state machine), fairness.ts, quotas.ts
   ├── lib/audit       – appendAudit(tx, …) with hash chain
   ├── lib/notify      – notify(tx, userId, type, payload) (+ email outbox)
   ├── lib/ai          – finder.ts, credentialCheck.ts, conditionDiff.ts (all with fallbacks)
   └── app/api/cron/tick – reminders, overdue, no-show, offer expiry
   │
   ├──► Supabase Postgres (Drizzle, transaction pooler)  RLS on, no client policies
   ├──► Supabase Storage (private buckets: resource-photos*, condition-photos, credential-docs)
   ├──► Anthropic API (optional, feature-flagged)
   └──► Resend (optional)
Vercel Cron ──every 5 min──► /api/cron/tick  (Bearer CRON_SECRET)
```
\* resource photos may be public. Everything else is private, served through signed URLs.

**Golden rule for every mutation:**
```ts
await db.transaction(async (tx) => {
  authorize(actor, 'booking.approve', booking);   // throws 403
  assertTransition(booking.status, 'APPROVED');   // throws 409
  await tx.update(bookings)...;                   // exclusion constraint may throw → map to "slot taken"
  await appendAudit(tx, {...reason});
  await notify(tx, booking.userId, 'booking.approved', {...});
});
```

---

## 4. Data model (Postgres)

```sql
-- people & org
organizations(id, name, kind ('HOST','PARTNER_COLLEGE','STARTUP'), email_domain null,
              agreement_status ('ACTIVE','SUSPENDED'), agreement_note, created_at)
departments(id, name, code)                              -- host departments only
profiles(id uuid pk = auth.users.id, full_name, email, org_id,
         role text check in ('user','external','manager','owner','admin'),
         identity_status ('NOT_REQUIRED','PENDING','VERIFIED','REJECTED'), id_doc_path null, id_ai_check jsonb null,
         identity_verified_by null, identity_reason null,
         department_id null, roll_no null, team_code null, suspended_until timestamptz null, created_at)
role_scopes(profile_id, department_id, role)            -- owner/manager per department

-- eligibility
credential_types(id, name, description, validity_days null, issuing_department_id)
user_credentials(id, profile_id, credential_type_id, status ('PENDING','VERIFIED','REJECTED','EXPIRED'),
                 evidence_path null, ai_check jsonb null, verified_by null, decision_reason, verified_at, expires_at)

-- resources
resources(id, department_id, owner_id, name, category ('space','equipment','computing','media'),
          description, location, photo_paths text[], usage_rules text, checklist jsonb,   -- [{key,label}]
          max_duration_min, turnaround_min default 15, advance_days default 14,
          requires_supervision bool, supervise_externals bool default true, open_to_externals bool default true,
          deposit_note text null, high_demand bool, status ('ACTIVE','MAINTENANCE','RETIRED'),
          qr_token text unique, created_at)
resource_requirements(resource_id, credential_type_id)
opening_hours(resource_id, weekday 0-6, opens time, closes time)
blackouts(id, resource_id, slot tstzrange, reason)

-- policy (global defaults, overridable per resource)
usage_policies(id, resource_id null, max_active_per_category, max_hours_week, cooldown_hours, group_share_pct,
               external_max_pct default 30, external_reserved_pct default 10)

-- bookings
bookings(id, resource_id, user_id, start_at, end_at, slot tstzrange,  -- includes turnaround
         purpose_category ('COURSEWORK','RESEARCH','PROJECT','SELF_LEARNING'), purpose_text, team_code null,
         status ('REQUESTED','PENDING_REVIEW','APPROVED','REJECTED','WAITLISTED','OFFERED','CANCELLED',
                 'IN_USE','OVERDUE','RETURNED','CLOSED','DISPUTED','NO_SHOW'),
         decision_reason, decided_by, score numeric, score_breakdown jsonb,
         offer_expires_at null, supervisor_id null, checked_out_at, returned_at, created_at)
  + exclude using gist (resource_id with =, slot with &&) where (status in ('APPROVED','IN_USE','OVERDUE'))
extension_requests(id, booking_id, new_end_at, status, decided_by, reason)

-- condition & incidents
condition_reports(id, booking_id, phase ('CHECKOUT','RETURN','INSPECTION'), checklist jsonb,  -- {key: ok|issue, note}
                  photo_paths text[], notes, recorded_by, ai_diff jsonb null, created_at)
incidents(id, booking_id null, resource_id, reported_by, type ('DAMAGE','DELAY','CONFLICT','MISUSE','SAFETY'),
          severity ('LOW','MEDIUM','HIGH'), description, ai_summary null,
          status ('OPEN','UNDER_REVIEW','RESOLVED'), resolution, penalty jsonb null,  -- {kind:'STRIKE'|'SUSPEND'|'DEPOSIT_NOTE', until?}
          reviewed_by, appeal_text null, appeal_status null, created_at)

-- cross-cutting
notifications(id, user_id, type, title, body, link, read_at, created_at)
audit_log(id bigserial, at, actor_id, actor_role, action, entity_type, entity_id, reason, data jsonb, prev_hash, hash)
app_settings(key, value jsonb)   -- demo_mode, offer_minutes, etc.
```
Indexes: `bookings(resource_id, start_at)`, `bookings(user_id, status)`, `audit_log(entity_type, entity_id)`, `notifications(user_id, read_at)`.

---

## 5. Core logic specs

### 5.1 Request-time checks (`lib/booking/precheck.ts`): run live in the form *and* again on submit
Return `{ ok, blocks: Reason[], warnings: Reason[] }`. Each `Reason = {code, message, fix?}`.
- `NOT_ELIGIBLE` → missing/expired credential → fix: "Book an induction" / "Upload certificate"
- `SUSPENDED` → until date + link to the incident
- `IDENTITY_UNVERIFIED` (external) → "Upload your college ID; a lab manager will verify it"
- `NOT_OPEN_TO_EXTERNALS`, `EXTERNAL_SHARE_FULL` → "External users have used 30% of this week's hours; next window opens Mon"
- `OUTSIDE_HOURS`, `BLACKOUT`, `TOO_LONG`, `TOO_FAR_AHEAD`
- `QUOTA_ACTIVE`, `QUOTA_HOURS`, `COOLDOWN`, `GROUP_CAP`
- warning `SLOT_CONTESTED` → "3 others requested overlapping time; the owner decides using the Fair-Share rule [explain]"

### 5.2 Fair-Share Score (`lib/booking/fairness.ts`, pure function, unit tested)
See decision D-007. The output includes `breakdown: [{label, points, explanation}]`. It is rendered identically for the owner and the requester.

### 5.3 Review screen
For the selected request, show: the requester's credential badges, history (completed / no-shows / incidents), conflicting requests ranked by score, and the system recommendation. The owner's buttons are **Approve** (disabled if it conflicts with an approved booking) / **Waitlist** / **Reject**, and a reason is required. If the owner approves one conflicting request, the others are moved to WAITLISTED in one action. That is "transparent handling of competing requests".

### 5.4 Waitlist offers
On CANCELLED / NO_SHOW / early RETURNED: find WAITLISTED requests whose slot now fits, take the highest score → `OFFERED` with `offer_expires_at`, and notify. If the user accepts → APPROVED (the constraint re-checks). If the offer expires → back to the queue and the next one is offered.

### 5.5 Scheduler tick (`/api/cron/tick`, idempotent)
1. APPROVED and start in ≤60 min, no reminder sent → remind
2. APPROVED and now > start + 15 min, not checked out → NO_SHOW + strike *proposal* (a manager confirms or waives)
3. IN_USE and now > end_at → OVERDUE + notify user and owner
4. IN_USE and end in ≤15 min → "return soon" reminder
5. OFFERED and expired → next offer
6. VERIFIED credentials past expires_at → EXPIRED

### 5.6 Rule-based suspicious-usage flags (admin dashboard)
- One `team_code` across ≥3 users holding >30% of a high-demand resource's slots this week
- ≥3 cancellations within 2 h of start in 14 days
- ≥2 overdue returns in 30 days

Each flag links to the underlying bookings. **Flags never act on their own.**

---

## 6. Routes / screens

| Route | Who | Purpose |
|---|---|---|
| `/login` | all | email login + "Try as…" demo buttons |
| `/` | all | catalog, search, filters, AI finder box |
| `/resources/[id]` | all | details, rules, eligibility checklist, availability grid, Request button |
| `/resources/new`, `/resources/[id]/edit` | owner | listing form (conditions, checklist, requirements, hours) |
| `/bookings` | user | my bookings by status, with reasons; cancel / extend / accept offer |
| `/bookings/[id]` | parties + admin | **timeline** (audit), condition before/after, incidents, actions |
| `/r/[qrToken]` | user / manager | phone-first check-out / return for the booking active now |
| `/manage/requests` | owner/manager | review queue with conflicts + scores |
| `/manage/resources` | owner | my listings, utilisation |
| `/signup` | external | partner-domain sign-up + ID upload |
| `/manage/credentials` | manager | verify/reject uploaded evidence **and external identities** (with AI check) |
| `/admin/partners` | admin | approved partner organisations, email domains, agreement status |
| `/manage/incidents` | manager/admin | triage, resolve, penalties, appeals |
| `/me/credentials` | user | passport: my badges, upload evidence |
| `/notifications` | all | notification centre |
| `/admin` | admin | policies, users/roles, flags, audit explorer + **Verify integrity**, Run scheduler, Reset demo |

---

## 7. AI implementation notes
- `lib/ai/client.ts`: returns `null` if `ANTHROPIC_API_KEY` is missing. Every caller handles `null` with the fallback path.
- Use **structured output** (a tool/JSON schema validated with Zod). Reject and fall back on a parse failure.
- Finder prompt gets: the user query + a compact catalog (id, name, category, location, requirements, next free slot) + the user's credentials. It returns `[{resourceId, why, eligible}]`.
- Credential check: image/PDF + the expected credential name + the profile name → `{nameMatches, credentialMatches, dateFound, issues[]}`.
- Condition diff: checkout photos+checklist vs return photos+checklist → `{possibleIssues:[{area, description, confidence}], summary}`.
- Timeout 15 s, store `{model, at, output}` in the jsonb column, and show the "AI suggestion: verify before acting" chip in the UI.
- Load the `claude-api` skill before writing this code to confirm current SDK usage.

---

## 8. Security and privacy checklist
- [ ] Every server action: `requireActor()` → `authorize()` → Zod-parse input
- [ ] RLS enabled on all tables, with no permissive client policies; service connection only on the server
- [ ] Private buckets + signed URLs (10 min); upload size/type limits (images ≤5 MB, PDF ≤5 MB)
- [ ] `audit_log`: revoke UPDATE/DELETE; verify chain
- [ ] `CRON_SECRET` on the cron route; demo-only admin actions blocked when `DEMO_MODE=false`
- [ ] No secrets in client bundles (`NEXT_PUBLIC_` only for the Supabase URL + anon key)
- [ ] Rate-limit AI endpoints per user (simple DB counter)
- [ ] Purpose text and documents visible only to the scoped owner/manager/admin
- [ ] Fictional seed data only

## 9. Accessibility checklist
- [ ] shadcn/Radix components, every input labelled, visible focus rings
- [ ] Status shown as **text + icon**, never colour alone; contrast AA
- [ ] Availability grid is keyboard-navigable and has a list fallback ("Next free slots")
- [ ] Plain-language reasons ("You need *Laser Safety Induction* (valid 12 months). Next session: Tue 3 pm.")
- [ ] Check-out/return flows usable on a 360 px phone screen

---

## 10. Seed data (fictional: host NIT-F, partners RCE and Kinetic Labs)

**Accounts** (password for all: `Demo@1234`, listed in README and the submission form)
| Persona | Email | Role | Story |
|---|---|---|---|
| Aarav Mehta | aarav@nitf.demo | user (NIT-F Mech) | Has Laser Safety → can book the laser cutter |
| Meera Nair | meera@rce.demo | external (Riverside College) | Identity pending + missing induction → full trust flow |
| Rohan Das | rohan@nitf.demo | user (NIT-F CSE) | Heavy GPU user → loses the Fair-Share tie, sees why |
| Priya Shah | priya@kineticlabs.demo | external (startup, verified) | Hits the external-share cap on the laser cutter |
| Dr. Kavita Rao | kavita@nitf.demo | owner (Mech) | Owns the makerspace |
| Sana Iqbal | sana@nitf.demo | manager (Mech) | Verifies credentials, supervises, inspects |
| Admin | admin@nitf.demo | admin | Policies, audit, disputes |

**Resources:** Laser Cutter (high demand, supervised, Laser Safety), 3D Printer ×2, DSLR Camera Kit (deposit note), Digital Oscilloscope (Electrical Safety L1), GPU Workstation (high demand), Seminar Room 204, Podcast Booth (Media Club membership).

**Pre-seeded states** so every screen has something on day one: one PENDING_REVIEW conflict pair on the laser cutter, one OVERDUE camera, one RETURNED item awaiting inspection, one OPEN damage incident, one PENDING credential upload, and a 2-week history so the scores differ.

---

## 11. Judge demo script (≈6 min; also goes in the submission's testing instructions)
1. **Owner (Kavita)** → creates "Soldering Station": requires Electrical Safety L1, max 2 h, checklist. *(step 1)*
2. **External student (Meera, Riverside College)** → AI finder: "I need to solder a sensor board tomorrow" → finds it → ❌ identity unverified, ❌ missing credential → uploads a college ID + safety certificate. *(2)*
3. **Manager (Sana)** → sees the AI checks ("name matches, partner org active, date found") → **Verify identity** + **Verify credential**. *(4)*
4. **Meera** → now ✅ → requests tomorrow 10–12, purpose: coursework. *(3)*
5. **Kavita** → review queue: Meera vs Rohan overlap → Fair-Share breakdown → approves Meera; Rohan auto-**waitlisted** with position and reason. *(5, 6)*
6. **Meera** → scans the QR / opens `/r/…` → check-out checklist + photo. *(7)*
7. **Meera** → return: marks "tip bent", photo → **Sana** sees before/after + AI diff → raises a DAMAGE incident (LOW) → resolves with "tip replaced, no penalty". *(8, 9)*
8. **Admin** → Run scheduler → the overdue camera gets flagged, notifications sent. **Verify integrity** ✅. *(9)*
9. Open the booking timeline as Meera, then as Kavita: the same complete history. *(10)*

---

## 12. Testing plan
- **Vitest** (H24+): `fairness.test.ts`, `transitions.test.ts` (every allowed/forbidden edge), `precheck.test.ts` (each block code), `audit.test.ts` (chain verify detects tampering).
- **DB:** script that tries two overlapping approvals in parallel → exactly one succeeds.
- **Playwright** (H36+): one spec running the demo script steps 4→7 against the preview URL.
- **Manual:** each teammate runs the demo script on the **production URL** at H40 and H46, on a phone and a laptop.

---

## 13. Submission checklist (the brief's 7 items)
- [ ] 1 Live URL (Vercel production) and a status check done the day before judging
- [ ] 2 Repo (public, or judges added) with a README: setup, env vars, seed, test commands
- [ ] 3 Project document (`docs/PROJECT.md` → PDF): use case, users, evidence, solution, workflow diagram, features, stack/architecture diagram, AI usage, privacy/security/fairness, limitations, future work
- [ ] 4 Testing instructions + the demo credentials table (§10) + the demo script (§11)
- [ ] 5 Team and participant details
- [ ] 6 Role and contribution of each member
- [ ] 7 Disclosure: Next.js, shadcn/ui, Drizzle, Supabase, Anthropic API, Resend, Vercel, **Claude Code used as an AI coding assistant**, any templates
- [ ] Optional: a 2–3 min screen recording of §11 (insurance if the live demo fails)
- [ ] **Submit by H46**, not H48

**Evidence to collect (before or at H0, allowed as research):** a 2-minute Google Form to 30+ peers ("Have you needed equipment your college owns but couldn't access? Why?") and a 5-minute chat with one lab in-charge about what stops them lending. Put the real numbers and quotes in the doc. **Do not invent statistics.**

---

## 14. 48-hour timeline (4 people: A = DB/backend, B = frontend catalog/booking, C = lifecycle flows, D = AI/QA/docs/deploy)

| Hours | A | B | C | D | Gate |
|---|---|---|---|---|---|
| **0–2** | Repo, Next.js, Drizzle, Supabase, schema v1 + migrations | shadcn setup, layout, nav, role-aware sidebar | Auth + demo login buttons | Vercel deploy + env, cron route stub | **Live URL at H2** |
| 2–8 | `authorize`, `transitions`, `appendAudit`, `notify` | Catalog + filters + resource page | Resource create/edit form | Seed script v1 (accounts + resources) | |
| 8–14 | Precheck + quotas + exclusion constraint | Availability grid + request form + precheck UI | Review queue (approve/reject/waitlist) | My bookings + booking timeline page | |
| 14–20 | Storage buckets + signed URLs | Notifications bell/centre | Check-out + return + inspection | E2E manual run, bug list | **H20: full lifecycle works end to end** |
| 20–24 | *sleep shifts: 2 on / 2 off; never all asleep* | | | | |
| 24–30 | Fairness score + waitlist offers + scheduler tick | Credential passport (upload) + manager verify screen | Incidents + penalties + appeal | Vitest for fairness/transitions/precheck | |
| 30–36 | Hash-chain verify, suspicious flags, admin policies | QR route `/r/[token]` mobile flow | Cancel + extension | AI finder, credential check, condition diff (with fallbacks) | |
| 36–40 | Reset demo + seed v2 (rich states) | Judge Mode checklist | Accessibility pass | Playwright spec, project doc draft | **H38: feature freeze** |
| 40–44 | Bug fixes only | Polish, empty states, copy | Bug fixes only | Doc final, diagrams, README, recording | |
| 44–46 | Prod smoke test (all 4, phone + laptop) | | | Fill out the submission form | **H46: SUBMITTED** |
| 46–48 | Buffer. Do not touch prod unless it is broken | | | | |

**2–3 person teams:** merge B+C, and D's AI work becomes P2. Cut order if behind: AI → email → extensions → QR → appeals. **Never cut:** audit timeline, condition before/after, waitlist, reasons.

---

## 15. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Lifecycle not done by H20 | P0 list is fixed; nobody starts P1 until the gate passes |
| Supabase pooler + Drizzle quirks | Use the transaction pooler URL with `prepare: false`; test a transaction at H2 |
| Free Supabase project pauses during judging | Daily keep-alive ping (cron), or upgrade for that week |
| AI quota/latency failures in the demo | Fallbacks + `AI_ENABLED` flag; the demo works with AI off |
| Judge corrupts demo state | "Reset demo data" button + a clear judge credentials list |
| Timezone bugs (IST vs UTC) | Store `timestamptz`, render with `Asia/Kolkata` explicitly |
| Merge conflicts at 3 a.m. | Feature folders per person, small PRs to `main`, schema changes only by A |
