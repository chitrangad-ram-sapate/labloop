# LabLoop

LabLoop is a campus resource sharing app. Students discover equipment and spaces, verify eligibility, hold inventory in a short lived cart, request bookings, and record condition reports. Owners and managers review requests and returns.
To access our live link please find https://labloop-ierl.onrender.com
user name : admin@nift.demo
password : LabLoop-Maple-River-47!

## Backend status

The active application data layer is Firebase Admin SDK with Cloud Firestore. PostgreSQL is no longer used by the Next.js routes. Existing files under `db/migrations/` are historical PostgreSQL schema references; they are not Firestore migrations and must not be run against Firebase.

The app still uses LabLoop's existing server signed sessions and password hashes in Firestore `profiles`; it does not use Firebase Authentication. Firebase Admin credentials are server only. `firestore.rules` denies all direct client access; Admin SDK bypasses those rules, so each server action/page must enforce LabLoop authentication and authorization itself.

This repository does not create a Firebase project, provision accounts, copy a PostgreSQL database, or populate production data. Do not point the app at an empty Firestore project and expect existing PostgreSQL resources/users to appear. Export and migrate any existing production records before switching the live service.

## Firebase Console setup

1. Create or select your project at [Firebase Console](https://console.firebase.google.com/).
2. In **Build → Firestore Database**, create a Firestore database in the region appropriate for your users. Start in production mode.
3. In **Project settings → General**, copy the Project ID into `FIREBASE_PROJECT_ID`.
4. In **Project settings → Service accounts**, generate a private service-account key for the server. Keep it outside the repository. Never put its private key in a `NEXT_PUBLIC_` variable, Git, a screenshot, or chat.
5. Create `.env.local` in the repository root from `.env.example` and add the Firebase project ID, a unique `SESSION_SECRET`, and local credentials as described below.
6. Add the same server-only variables to Render's environment settings, then redeploy the service.

For a **brand-new, empty** Firestore project, set the one-time `LABLOOP_ADMIN_EMAIL`, `LABLOOP_ADMIN_PASSWORD`, `LABLOOP_ADMIN_NAME`, `LABLOOP_HOST_ORG_NAME`, and `LABLOOP_HOST_EMAIL_DOMAIN` values in `.env.local`, then run `npm.cmd run firebase:bootstrap`. It creates the first admin, host organization, and four departments only when the protected collections are empty. It refuses to run if it finds LabLoop business data. Remove the bootstrap values afterward. Never run this against a project with data you need to keep.

For an already populated project that has exactly one active `HOST` organization for the configured host domain but no admin profile, run `npm.cmd run firebase:create-admin` with `LABLOOP_ADMIN_EMAIL`, `LABLOOP_ADMIN_PASSWORD`, `LABLOOP_ADMIN_NAME`, and `LABLOOP_HOST_EMAIL_DOMAIN` set in the private `.env.local`. This only creates a new admin profile and its `email_lookup` document; it refuses to overwrite an existing account or create a second admin. It does not create or change campus records. If the project contains an admin already, use that admin's account recovery process. Run this only against the intended Firebase project.

## Local Windows setup

In PowerShell, from the repository directory:

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

For local development, the safer option is to store the downloaded service-account JSON somewhere outside the repo (for example, a private folder under your Windows profile) and set:

```dotenv
FIREBASE_PROJECT_ID=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=C:\Users\your-windows-user\private\firebase-admin.json
SESSION_SECRET=your-own-long-random-session-secret
CRON_SECRET=your-own-long-random-cron-secret
LABLOOP_ADMIN_EMAIL=admin@your-campus-domain.edu
LABLOOP_ADMIN_PASSWORD=your-own-unique-long-password
LABLOOP_ADMIN_NAME=Your Name
LABLOOP_HOST_ORG_NAME=Your Campus Name
LABLOOP_HOST_EMAIL_DOMAIN=your-campus-domain.edu
```

These are names and format examples only; replace the values yourself. Keep `.env.local` private. The project `.gitignore` ignores `.env*` files. On Render, set `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON` (the full service-account JSON as a secret environment value), `SESSION_SECRET`, and `CRON_SECRET` in the service's Environment page. Never share the key with me.

For a new empty project, after completing the bootstrap settings above, initialize the records and verify configuration:

```powershell
npm.cmd install
npm.cmd run firebase:bootstrap
npm.cmd run firebase:check
npm.cmd run dev
```

For an existing project instead, use `npm.cmd run firebase:create-admin` in place of `firebase:bootstrap`. Create a regular user through `/signup` after confirming the matching active organization exists. The app has no seeded demo-account data and does not support passwordless demo login; `meera@rce.demo` is only mentioned in an old implementation plan, so its presence and password are unverified. Passwords are stored as scrypt hashes and cannot be read back from Firestore.

`firebase:check` checks for credentials and Firestore connectivity without printing key material. It lists top-level collections and warns when the core data collections are missing. Restart `next dev` after changing environment variables.

## Firestore structure

The application expects documents in these collections, with document IDs matching referenced IDs:

| Collection | Purpose |
|---|---|
| `organizations`, `departments` | Campus and department reference data |
| `profiles`, `email_lookup` | User profiles, password hashes, session identity lookup |
| `resources`, `resource_requirements`, `credential_types`, `user_credentials` | Resource inventory and eligibility |
| `cart_items`, `bookings` | Temporary holds and booking lifecycle |
| `condition_reports`, `incidents` | Before/after Condition Vault and incident review |
| `complaint_tickets`, `complaint_messages` | Customer issue status and timestamped evidence history |
| `notifications`, `owner_access_requests`, `audit_log`, `_system/audit_head` | In-app notices, owner onboarding, tamper-evident history |

Reference IDs such as `department_id`, `user_id`, `resource_id`, and `credential_type_id` must point to the corresponding document IDs. Use `firebase.json` to deploy `firestore.rules` and `firestore.indexes.json` after installing/authenticating the Firebase CLI. The rules intentionally prevent browser clients from reading/writing these collections; app access goes through authorized server actions.

The old SQL migrations describe the relational schema and business entities but are not automatically converted. Before production cutover, transform and verify existing Postgres rows, relationships, and photo/evidence data in Firestore. The app does not include a seed/reset command; this avoids accidentally replacing real project data with fictional demo records.

## Deploy Firestore rules and indexes

With the Firebase CLI installed and authenticated to your own project:

```powershell
firebase login
firebase use --add
firebase deploy --only firestore:rules,firestore:indexes
```

Verify the selected project before deployment. Create the Firestore database in Console first. Add any additional composite index requested by Firestore as usage grows, then commit the generated index definition.

## Run and verify

```powershell
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run build
```

The application requires a configured Firestore project and pre-existing records before sign-in/catalog/booking flows can be exercised. Do not treat a successful build or connectivity check as proof that real user journeys or production data migration passed.

## Architecture

Next.js App Router, server components and server actions run on Render. `src/lib/firebase.ts` lazily initializes the Firebase Admin SDK so builds do not require live credentials. Firestore transactions serialize inventory changes through each resource's `availability_version`; cart holds expire after 12 minutes, and `/api/cron/tick` releases expired holds and advances booking reminders/offers. All business decisions remain on the server.

The UI includes resource discovery, filters, eligibility messages, cart and combined booking requests, owner review, condition reports, trust summaries, complaints, and audit history. Optional AI summaries are advisory and do not replace human decisions.
