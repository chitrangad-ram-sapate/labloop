# decision.md — LabLoop (Codeverse Hackathon)

Decision log for the team. Each entry: **context → options → decision → why → revisit if**.
Status key: ✅ decided · 🟡 decide at kickoff · 🔁 revisit after the walking skeleton works.

---

## D-000 How we win (the scoring logic everything else follows)

| Criterion | Pts | What actually earns the points | Our lever |
|---|---|---|---|
| Working end-to-end product | 20 | Judge finishes listing → return **alone**, nothing broken | One-click demo accounts, guided "Judge Mode" checklist, seeded data, deploy from hour 2 |
| Strength of core solution | 20 | Focused flow, clear outcome for owner **and** user | One institution, one lifecycle, every state has a visible reason |
| Understanding of problem | 15 | Trust, safety, accountability, plus evidence | Peer survey + lab-in-charge interview quotes in the doc |
| Technical depth & reliability | 15 | Sound architecture, consistent behaviour | DB-level double-booking guard, state machine, hash-chained audit, tests |
| Trust, safety, accountability | 10 | Verification, permissions, condition records, disputes, human review | Credential passport, supervised check-in, before/after diff, incidents, appeals |
| Fair allocation & accessibility | 10 | No monopolising, transparent method, understandable UI | Hard quotas + explainable Fair-Share Score + waitlist offers + WCAG basics |
| Originality & real-world potential | 10 | Better than a booking system, could be adopted | "Eligibility passport", explainable allocation, tamper-evident log, QR at the asset |

**40 of the 100 points (rows 1–2) come from a reliable, focused core.** We build the full lifecycle first. Everything fancy comes after the walking skeleton is complete, end to end, at **H20**.

---

## D-001 ✅ Our problem statement (chosen from the "Unlock Underused Equipment and Spaces" track)

The track text is an umbrella. Our problem statement must be narrower, but it still has to cover every element the track lists: verified owners, eligibility, approvals, waitlists, check-in/out, condition records, damage, cancellations, conflicts, incidents, fairness and an audit trail.

### Candidates

| # | Candidate PS | Covers the track fully? | Buildable in 48h | Originality / real-world | Risk | Verdict |
|---|---|---|---|---|---|---|
| **1** | **Open Campus Labs**: one college opens its idle makerspace, lab equipment and rooms to its own students **and** to verified outsiders (students from nearby colleges, early-stage startup teams) | **Yes, every element arises naturally**: outsiders *need* verification, deposits, supervision and fair quotas | High (one host org, many user orgs) | **High**: matches the track's "nearby students, researchers, creators and early-stage teams" | Low | ✅ **Pick** |
| 2 | Campus-internal sharing across departments | Mostly. Trust and verification feel thin when everyone is already a student | Very high | Medium: reads like "a better room-booking app" | Low | Fallback if the team is 2 people |
| 3 | Regional research-instrument sharing (SEM, HPLC, PCR) across institutes, like India's I-STEM portal | Yes | Low: operator-run instruments, sample workflows and multi-tenant owners are hard to demo | Very high | High | ✗ (cite I-STEM as evidence the need is real) |
| 4 | Student-club media gear library (cameras, drones, mics) | Partly. Weak on institutional approval and supervision | Very high | Low: judges see a lending library | Low | ✗ |
| 5 | School tinkering labs opened to community kids after hours | Yes | Medium | High | **High**: minors, guardian consent, rule 11 safety | ✗ |
| 6 | School/college halls and classrooms lent to NGOs on weekends | Partly. Spaces only, with thin condition/eligibility needs | High | Medium | Low | ✗ |

### Decision: PS #1. Text to put in the project document

> **Title:** Open Campus Labs: safely lending a college's idle makerspace and lab equipment to verified students and early-stage teams from nearby institutions.
>
> **One-line:** A trusted platform through which a host college's departments list underused equipment and spaces, and both internal students and verified external users (partner-college students, incubated startups) can discover, qualify for, book, use and return them with full accountability.
>
> **Problem:** Colleges with well-equipped makerspaces and labs (laser cutters, 3D printers, oscilloscopes, GPU workstations, studios, seminar rooms) leave them idle for much of the week. Students at nearby colleges with weaker facilities, and early-stage hardware/media startups, need exactly this equipment but cannot afford to buy or rent it. Lab in-charges will not lend to strangers without knowing who they are, whether they are trained, what they will use it for, and what condition it comes back in. Internal students also fear outsiders crowding them out. Existing booking sheets or forms handle none of this.
>
> **Scope:** One host institution (fictional *Northfield Institute of Technology*). Several partner organisations (fictional *Riverside College of Engineering* and the startup *Kinetic Labs*). Resource types: equipment, computing and spaces. Bookings are free, with deposits noted and collected at the desk.
>
> **Must deliver:** verified owner listings with conditions → discovery and eligibility check → request → automated requirement checks → owner/manager review → approve/reject/waitlist with reasons → check-out with condition record → return with condition record → damage/delay/conflict incidents with human review → fair allocation between and within internal and external users → a complete auditable history visible to both parties.

**Why #1 wins:** The outsider makes every trust feature *necessary* rather than decorative. Identity verification (who is this person?), credential verification (are they trained?), supervision and deposits (higher risk), fairness between groups (internal vs external quota) and the audit trail (accountability across organisations) all follow from it. It still has a **single owner organisation**, so we avoid multi-tenancy.

**Fictional organisations:** host *Northfield Institute of Technology (NIT-F)*, with departments Mechanical, ECE, CSE and Media Studio. Partners: *Riverside College of Engineering (RCE)* (email domain `rce.demo`) and *Kinetic Labs* (an incubated startup).

**Revisit if:** the team has only 2 people. Then drop to PS #2 and keep the external path as a stretch goal. Never change the PS after H2.

---

## D-002 ✅ Product name and positioning

- **Name:** **LabLoop**: "every resource, every hand-off, accounted for."
- **One-liner for judges:** *LabLoop lets a college safely open its idle labs and equipment to its own students and to verified students and startups nearby. Every user is verified and every resource checks eligibility. High-demand items are allocated by a rule anyone can read. Every hand-off leaves a tamper-evident record.*
- **Not** "a booking system with extra features". The positioning is **"an accountability layer for lending institutional property."**

---

## D-003 ✅ Stack

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| App | **Next.js (latest stable, App Router) + TypeScript** | One deployable, server actions, team familiarity | Separate FE/BE (two deploys, CORS, double the risk) |
| UI | **Tailwind + shadcn/ui** | Accessible primitives (Radix), fast | MUI (heavier), custom CSS |
| DB | **Supabase Postgres** | Managed, free tier, `btree_gist` exclusion constraints, pg_cron | SQLite (no exclusion constraints, hard to deploy) |
| ORM | **Drizzle** over the Supabase pooler | Real **transactions in TS**, so status + audit + notification commit atomically | supabase-js for writes (no transactions) |
| Auth | **Supabase Auth** (email + password; magic link optional) | Built in, ready for institution-domain checks | Auth.js (more wiring) |
| Files | **Supabase Storage**, private buckets + signed URLs | Condition photos, credential documents | Public bucket (privacy fail) |
| AI | **Anthropic Claude** via `@anthropic-ai/sdk` (`claude-haiku-5-5` for extraction/summaries, `claude-sonnet-5-5` for matching) | Structured output, vision for photos | No AI (loses originality points) |
| Validation | **Zod** shared by forms and server actions | One schema, two uses | — |
| Hosting | **Vercel** (+ Vercel Cron) | Zero-config Next.js, preview URLs | Render (slower cold start for demo) |
| Tests | **Vitest** (rules engine, state machine) + **Playwright** (1 happy-path journey) | Proves reliability to judges | — |

**Revisit if:** nobody on the team knows Drizzle. Then use supabase-js plus **Postgres RPC functions** for each state transition, so atomicity still lives in the DB.

---

## D-003a ✅ Changes made during the build (supersede D-003 where they differ)

| Area | Planned | Built | Why |
|---|---|---|---|
| Hosting | Vercel | **Render free web service** (Singapore) | The whole stack must be free tier. Firebase App Hosting needs the paid Blaze plan. The scheduler's 10-minute ping keeps the free instance awake for judges. |
| DB access | Drizzle ORM | **postgres.js with plain SQL** | Fewer layers. Transactions via `sql.begin`; schema in `db/migrations/*.sql`. |
| Auth | Supabase Auth | **Own sessions** (scrypt passwords, HMAC-signed httpOnly cookie) | Demo accounts and one-click judge logins need no email round trip. Email-ownership codes are added on top for real sign-ups. |
| AI | Anthropic | **Groq** (`openai/gpt-oss-120b` for text, `qwen/qwen3.8-27b` for vision), free tier | Key available to the team. Every call is advisory, labelled, and has a non-AI fallback. |
| Scheduler | Vercel Cron | **GitHub Actions** every 10 min + admin "Run now" button | Free; Vercel Hobby cron is daily only. |
| Next.js | — | **Next 16 with Cache Components** | Per-user parts stream inside `<Suspense>`. |

## D-004 ✅ Authorization model

- Roles: `user` (host-college student/researcher), `external` (partner-college student or startup member; can book only after identity verification), `manager` (lab assistant: verifies credentials, supervises check-in, inspects returns), `owner` (lab in-charge/faculty: lists resources, sets rules, approves), `admin` (policies, disputes, audit).
- Roles are **scoped**: a manager or owner role belongs to a **department**, so a Mech owner cannot approve ECE bookings.
- **All writes go through server actions** that call one `authorize(actor, action, entity)` module. The browser never touches tables directly.
- **RLS is enabled on every table with no anon/authenticated policies.** The DB rejects direct client access by default, and the server uses its own connection. This is defence in depth and simple.

---

## D-005 ✅ Booking lifecycle = an explicit state machine

```
REQUESTED ──auto checks──► PENDING_REVIEW ──owner──► APPROVED ──check-in──► IN_USE ──return──► RETURNED ──inspect──► CLOSED
     │                          │                      │                     │                        └──► DISPUTED ──admin──► CLOSED
     │ (blocked, with reason)   ├──owner──► REJECTED   ├──user──► CANCELLED  └─(past end)─► OVERDUE ─return─► RETURNED
     ▼                          └──owner──► WAITLISTED ─slot frees + accept─► APPROVED
  not submitted                                          └──(no check-in +15m)──► NO_SHOW
```
- Transitions live in one table-driven module (`lib/booking/transitions.ts`) and are unit tested.
- **Every transition requires a `reason`** (free text or preset). The reason is shown to the user and written to the audit log.
- `OVERDUE` is a flag state set by the scheduler, not by a person.

---

## D-006 ✅ Preventing double-booking: in the database, not just the UI

```sql
create extension if not exists btree_gist;
alter table bookings add constraint no_overlap
  exclude using gist (resource_id with =, slot with &&)
  where (status in ('APPROVED','IN_USE','OVERDUE'));
-- slot = tstzrange(start_at, end_at + resource.turnaround_minutes)
```
**Why:** Two owners clicking "approve" at the same moment cannot both win. That is technical depth judges can verify. The UI also shows conflicts *before* approval ("2 other requests overlap this slot").

---

## D-007 ✅ Fair allocation: hard limits + an explainable score + a human decision

1. **Hard limits** are enforced at request time and shown in the UI before submitting:
   - max **2 active bookings** per user per category
   - max **6 h/week** per user on a `high_demand` resource
   - **48 h cooldown** between bookings of the same high-demand resource
   - max **14 days** advance booking
   - group cap: one `team_code` may hold at most **30%** of a high-demand resource's weekly slots
   - **population split** (owner-set per resource): external users together may hold at most **30%** of weekly hours, so internal students are never crowded out. The owner may also *reserve* a minimum (e.g. 10%) for external users, so outsiders always get a chance. Both numbers are shown on the resource page.
2. **Fair-Share Score** ranks competing requests for the same slot. It is shown as a breakdown to both the owner and the requester:
   ```
   score = purpose_weight          (coursework/assessment 30 · research 25 · club/project 15 · self-learning 10)
         + fairness  = 40 × (1 − min(hours_used_last_30d / 20, 1))
         + newcomer  = 10 if first use of this resource
         − reliability = 10 × no_shows_last_60d   (max −30)
   tie → earliest submitted_at
   ```
3. **The owner decides.** The system *recommends* the top-scoring request. The owner can override, but an override requires a reason, and the reason is audited.
4. **Waitlist offers:** when a slot frees up (cancel, no-show, early return), the top waitlisted request gets an **offer** with a timer (30 min; 2 min in demo mode). If it is not accepted, the offer passes down the list. Waitlisted requests were already reviewed by the owner ("approve if a slot frees"), so this is not an unreviewed automated access decision.

**Rejected:** a pure lottery (feels random, hard to explain); pure first-come (rewards whoever refreshes fastest, which is exactly the monopolisation problem).
**Revisit if:** time remains after H32. Then add a "request window + batch allocation" mode for the laser cutter (P2).

---

## D-008a ✅ External identity verification (comes before credentials)

1. The partner organisation must be on the host's **approved partners** list (an MoU/agreement is recorded by an admin, along with the partner's email domain).
2. The external user signs up with an email on that domain (e.g. `@rce.demo`). Startups without a domain are endorsed by the incubator.
3. They upload a college ID or incubator letter. AI extracts name, organisation and validity (advisory).
4. A host **manager approves or rejects with a reason**. Until then the account can browse but not request.
5. External users default to **supervised** use on resources flagged `supervise_externals`, and the deposit note always applies to them.

## D-008 ✅ Eligibility: the "Credential Passport"

- `credential_types` (e.g. *Laser Cutter Safety Induction*, *Electrical Safety Level 1*, *Media Club Membership*), each with an optional validity period.
- A resource lists its required credentials. The resource page shows **✅ you have / ❌ missing → how to get it** *before* the user requests.
- The user uploads evidence → AI extracts name/date/course and flags mismatches (advisory) → a **manager verifies or rejects with a reason**. Only a human grants a credential.
- Missing **required** credential = the request button is disabled with an explanation. This is a published rule, not a decision, so it does not conflict with rule 12. The user can instead "Request induction slot".

---

## D-009 ✅ Condition and incidents

- **Check-out (start):** a checklist per resource type plus at least one photo. Supervised resources need the manager to confirm on their phone.
- **Return:** the same checklist plus photos. LabLoop shows **before vs after side by side**.
- **AI condition diff** (advisory): compares the two reports and suggests "possible new scratch on lens". It is labelled *AI suggestion: needs inspection* and **never** creates a penalty by itself.
- **Incidents:** types `damage | delay | conflict | misuse | safety`, with severity, a lifecycle `OPEN → UNDER_REVIEW → RESOLVED`, a resolution note, and an optional penalty.
- **Penalties** (strike, temporary suspension, deposit deduction note) need a manager or admin, need a reason, and **the user can appeal** once. The appeal goes to an admin. This is the human-oversight story judges look for.

---

## D-010 ✅ Audit log: append-only, hash-chained

- `audit_log(id, at, actor_id, actor_role, action, entity_type, entity_id, reason, data jsonb, prev_hash, hash)`
- `hash = sha256(prev_hash || canonical_json(row))`, computed inside the same transaction as the action, serialized with `pg_advisory_xact_lock`.
- `UPDATE` and `DELETE` are revoked for the app role on `audit_log`.
- Admin page has a **"Verify integrity"** button that recomputes the chain and shows ✅ or the first broken row. It is cheap to build and memorable in a demo.
- Both parties see the **booking timeline**: the audit rows filtered to that booking.

---

## D-011 ✅ Notifications

- **In-app** notification centre (a DB table plus a bell). This is P0 and always works.
- **Email** via Resend for approval, rejection, waitlist offer and overdue. P1, and optional if the key is present.
- **Scheduler:** Vercel Cron every 5 minutes calls `/api/cron/tick` (protected by a secret). It sends reminders (1 h before start, 15 min before end), flags overdue, marks no-shows and expires offers.
- **Demo:** admin has a **"Run scheduler now"** button. Seed data already contains an overdue booking, so judges never wait.

---

## D-012 ✅ Payments and deposits

**Free, institutionally sponsored.** Deposits are shown as a condition ("₹2,000 refundable deposit collected at the lab desk") and confirmed by the manager at check-out as a checkbox. **No payment integration**: it adds risk and no points.

---

## D-013 ✅ AI scope: three features, all advisory, all with fallbacks

| Feature | Model | Output | Human gate | Fallback (no key or error) |
|---|---|---|---|---|
| Natural-language finder ("I need to cut acrylic for a drone frame by Friday") | sonnet | ranked resources + why + eligibility status | none needed (discovery only) | keyword + category filter |
| Credential document check | haiku (vision) | extracted fields + mismatch flags | manager verifies | manager reviews manually |
| Condition diff / incident summary | haiku (vision) | "possible issues" + summary | manager inspects; penalties are human-only | side-by-side view only |

**Rules:** every AI output is labelled as AI. It is stored with the model id and timestamp. It can never change a booking state.
**Suspicious-usage flags are rule-based, not AI:** proxy booking (same `team_code` across many users), repeated last-minute cancellations, chronic overstays. They are explainable by construction.

---

## D-014 ✅ Privacy and data minimisation

- We collect: name, institutional email, organisation, department, optional roll number, credentials, booking purpose, and for external users an ID document (seen only by verifying managers; delete after verification is a stated policy).
- Credential documents and condition photos go in **private** buckets with 10-minute signed URLs. Only the verifying manager or the owning department can view them.
- Owners see a requester's **credential status**, not the document itself (unless they are also the verifier).
- The booking purpose is visible only to the owner/manager of that resource, and to admins.
- A data-retention statement is in the doc (e.g. documents deleted 30 days after a credential expires). Implementing it is future work.
- **All demo data is fictional** (rule 10).

---

## D-015 ✅ Judge experience

- Login page has **"Try as…"** buttons: Student (eligible), Student (missing training), Heavy user, Owner, Manager, Admin. They log in instantly with seeded accounts.
- A dismissible **Judge Mode checklist** panel walks the 10 lifecycle steps and ticks itself off as the judge completes them.
- **"Reset demo data"** (admin only) reseeds the database, so a judge who breaks the state can recover.

---

## D-016 🟡 Decide at kickoff (H0, ≤15 min)

- [ ] Team size and role assignment (plan assumes 4; see IMPLEMENTATION_PLAN §14)
- [ ] Who owns the Vercel and Supabase accounts (must stay live through judging)
- [ ] Is an Anthropic API key available with enough credit? If not, ship the fallbacks only
- [ ] Repo: public GitHub or private with judge access
- [ ] Exact submission deadline in local time → **our internal deadline is 2 h earlier**

---

## D-017 ✅ Explicitly out of scope (say so in "Known limitations")

Multiple *owner* institutions (we have one host and many user organisations) · payments · native mobile app · real ID or SSO integration · IoT door locks · automated penalties · full-text search engine · i18n.
