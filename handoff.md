# handoff.md — LabLoop

**For:** any teammate, or a fresh AI coding session, picking up this project.
**Read in this order:** this file → `decision.md` → `IMPLEMENTATION_PLAN.md`.

## Where we are (Fri 30 Oct, 18:30 IST; window closes Sun 1 Nov 10:00)
- ✅ Problem statement: **"Open Campus Labs"** (decision D-001).
- ✅ **Live:** https://labloop-9iqv.onrender.com (Render free, Singapore). Repo: https://github.com/chitrangad-ram-sapate/labloop
- ✅ Full lifecycle built and **verified end to end on production** by `e2e/journey.spec.ts` (3/3 pass). Unit tests: `npm test`.
- ✅ Database: Supabase `labloop` (ref `ituoqdxzgiahgoyknynf`, Mumbai, account deluludevss@gmail.com). The app connects as least-privilege role `labloop_app` through the **session pooler :5432**. Migrations are in `db/migrations/`.
- ✅ Scheduler: Supabase `pg_cron` job `labloop-tick` calls `/api/cron/tick` every 10 min (secret in Vault). Results are in `net._http_response`.
- ✅ AI (Groq) wired in `src/lib/ai.ts` + `ai-jobs.ts`; works locally. **Not active on production until `GROQ_API_KEY` is added in Render.**
- 🟡 Remaining:
  - Add `GROQ_API_KEY` in Render (human step).
  - Private photo storage (needs the Supabase `sb_secret_…` key).
  - Email-ownership codes at sign-up (needs Gmail app password).
  - Write the submission document.
- Stack changes from the plan are listed in `decision.md` D-003a.

### Gotchas learned
- **Never run `npm run seed` while a deploy is swapping instances.** A killed instance can leave a backend mid-transaction. `labloop_app` now has `statement_timeout=30s`, and the seed uses `lock_timeout=5s`.
- Use the **session** pooler (5432) for the long-running Render server, not the transaction pooler (6543).
- Pushing to `main` auto-deploys Render (about 2 min), so don't run e2e during a deploy.
- Run e2e against prod: `npm run seed && BASE_URL=https://labloop-9iqv.onrender.com npx playwright test`, then `npm run seed` again to reset for judges.

## Team and ownership (commits are authored by the area owner)
| Area | Owner | Commit author |
|---|---|---|
| A: DB/backend (schema, auth, rules engine, audit) | chitrangad-ram-sapate | `chitrangad-ram-sapate <chitrangadsapate7@gmail.com>` |
| B: catalog, resource page, booking screens | prabhanjan-beep | `prabhanjan-beep <purohitprabhanjan@gmail.com>` |
| C: check-out/return, condition, incidents | sadanaasabari-1606 | `sadanaasabari-1606 <sadanaasabari@gmail.com>` |
| D: AI, QA, docs, deploy | giraseshruti777 | `giraseshruti777 <giraseshruti@gmail.com>` |

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
