# handoff.md — LabLoop

**For:** any teammate, or a fresh AI coding session, picking up this project.
**Read in this order:** this file → `decision.md` → `IMPLEMENTATION_PLAN.md`.

## Where we are (2026-10-30)
- ✅ Track analysed. Our problem statement: **"Open Campus Labs": one host college (fictional Northfield Institute of Technology) safely lends its idle makerspace, lab equipment and rooms to its own students and to verified outsiders (partner-college students, incubated startups)** (decision D-001, which includes the 6 candidates we compared and the PS text for the submission).
- ✅ Architecture, data model, state machine, fairness rule, AI scope and timeline all decided (`decision.md` D-002…D-017).
- ⛔ **No product code written. This is deliberate.** Hackathon rule 2: code only during the 48 h window. Do not scaffold early.
- 🟡 Open items to settle at kickoff: see `decision.md` D-016 (team size/roles, account owners, API key, repo visibility, exact deadline).

## The one-paragraph brief
LabLoop is a web app where a host college's department owners list idle resources with conditions (required credentials, supervision, deposit, max duration, checklist). External users from approved partner organisations sign up with their institutional email and are identity-verified by a manager before they can book. Internal and external users find a resource (filters or an AI finder), see exactly which requirements they meet, and request a slot. Hard quotas stop hoarding, and an internal/external share cap keeps either group from crowding out the other. When requests collide, the owner sees an explainable **Fair-Share Score** and decides; the losing requests are waitlisted and auto-offered freed slots. Check-out and return each capture a checklist and photos, and a manager inspects. Damage, delays and conflicts become incidents with human-only penalties and one appeal. Every action lands in a **hash-chained audit log** that both parties can see as a booking timeline.

## Non-negotiables (break these and we lose points)
1. **The full lifecycle works end to end by H20** before any P1 work.
2. **AI and rules recommend; humans decide** access and penalties (rule 12). Label all AI output.
3. **Every state change has a reason**, shown to the user and written to `audit_log` in the same transaction.
4. **Double-booking is prevented by the DB exclusion constraint**, not only the UI.
5. **Fictional data only.** Live URL up from H2 and through the whole judging period.
6. **Submit at H46.**

## Hour-0 commands (run when the window opens)
```bash
npx create-next-app@latest labloop --ts --tailwind --app --eslint --src-dir --import-alias "@/*"
cd labloop && git init && git add -A && git commit -m "chore: scaffold"
npx shadcn@latest init
npm i drizzle-orm postgres zod @supabase/ssr @supabase/supabase-js @anthropic-ai/sdk qrcode date-fns date-fns-tz
npm i -D drizzle-kit vitest @playwright/test @types/qrcode
# create Supabase project → enable extensions: btree_gist, pgcrypto
# vercel link && vercel env pull
```

## Environment variables
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # server only (storage signed URLs, admin seed)
DATABASE_URL=                       # Supabase transaction pooler :6543, use prepare:false
ANTHROPIC_API_KEY=                  # optional; empty → AI fallbacks
AI_ENABLED=true
RESEND_API_KEY=                     # optional
CRON_SECRET=
DEMO_MODE=true                      # enables Try-as buttons, Run scheduler, Reset demo
APP_TZ=Asia/Kolkata
```

## Proposed repo layout
```
src/
  app/                    # routes per IMPLEMENTATION_PLAN §6
  components/             # ui/ (shadcn) + feature components
  db/schema.ts            # owned by person A only
  db/seed.ts
  lib/auth.ts             # requireActor()
  lib/authorize.ts        # can()/authorize()
  lib/booking/{transitions,precheck,fairness,quotas,offers}.ts
  lib/audit.ts            # appendAudit(tx, …), verifyChain()
  lib/notify.ts
  lib/ai/{client,finder,credentialCheck,conditionDiff}.ts
  app/api/cron/tick/route.ts
tests/                    # vitest + playwright
docs/PROJECT.md           # submission document
```

## Shared contracts (agree on these at H0 so everyone can work in parallel)
```ts
type Role = 'user' | 'external' | 'manager' | 'owner' | 'admin';
type Actor = { id: string; role: Role; orgId: string; deptIds: string[]; identityVerified: boolean };
type BookingStatus = 'REQUESTED'|'PENDING_REVIEW'|'APPROVED'|'REJECTED'|'WAITLISTED'|'OFFERED'
  |'CANCELLED'|'IN_USE'|'OVERDUE'|'RETURNED'|'CLOSED'|'DISPUTED'|'NO_SHOW';
type Reason = { code: string; message: string; fix?: { label: string; href: string } };
type ScoreBreakdown = { label: string; points: number; explanation: string }[];

transition(tx, actor, bookingId, to: BookingStatus, reason: string, data?: object): Promise<Booking>
appendAudit(tx, { actor, action, entityType, entityId, reason, data }): Promise<void>
notify(tx, userId, type, { title, body, link }): Promise<void>
precheck(actor, resourceId, startAt, endAt, purpose): Promise<{ ok: boolean; blocks: Reason[]; warnings: Reason[] }>
fairShare(input): { score: number; breakdown: ScoreBreakdown }   // pure
```

## Conventions
- Server actions live next to their route (`actions.ts`) and always run `requireActor → authorize → zod.parse → db.transaction`.
- Store all times as `timestamptz` and render in `APP_TZ`.
- Commit at least hourly with descriptive messages (rule 15 evidence). Push small changes to `main`; schema changes go through person A.
- User-facing copy: plain language, always say *why* and *what next*.

## First 5 tasks (in order)
1. Scaffold + deploy an empty app to Vercel (live URL by H2).
2. `db/schema.ts` from IMPLEMENTATION_PLAN §4 + migration + `btree_gist` exclusion constraint; prove one transaction works through the pooler.
3. Auth + `requireActor` + seeded demo accounts + "Try as…" buttons.
4. `transitions.ts` + `appendAudit` + `notify`, with Vitest for allowed/forbidden transitions.
5. Resource create → catalog → resource page → request → review → check-out → return → timeline (the H20 gate).

## Things not to do
- Don't add payments, multi-tenancy, a native app or SSO (D-017).
- Don't let any AI output change a booking, credential or penalty state.
- Don't use real student names, photos or IDs.
- Don't deploy risky changes after H44.
