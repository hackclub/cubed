# Cubed Developer Documentation

Table of Contents

* [What is Cubed?](#what-is-cubed)
  * [Project lifecycle](#project-lifecycle)
* [Repository Structure](#repository-structure)
* [The Frontend](#the-frontend)
  * [Pages](#pages)
  * [The dashboard room](#the-dashboard-room)
  * [Design system](#design-system)
  * [Auth/routing gating](#authrouting-gating)
* [The Backend](#the-backend)
  * [API Routes](#api-routes)
  * [Economy](#economy)
  * [Eligibility gating](#eligibility-gating)
  * [Database](#database)
* [Airtable](#airtable)
* [External integrations](#external-integrations)
* [Security model](#security-model)
* [Getting Started](#getting-started)
  * [Prerequisites](#prerequisites)
  * [Install](#install)
  * [Environment Variables](#environment-variables)
  * [Run](#run)
  * [Database Migrations](#database-migrations)
* [Contributing](#contributing)

## What is Cubed?

Cubed is a Hack Club YSWS ("You Ship, We Ship") program: a teenager builds
and ships a science-related project, submits it for review, and — once a
reviewer logs hours against it in Airtable — earns **moles**, this
program's in-app currency, which can be spent in an in-app shop for
science-related prizes.

The app itself is split into two separately-deployable services:

- **`/frontend`** — the Astro + Svelte site a user actually sees: landing
  page, onboarding, the dashboard "room," docs, and a small admin panel.
- **`/backend`** — a Hono API that owns the database, talks to Airtable
  and a handful of other Hack Club services, and is the only thing with
  real secrets.

They communicate over plain HTTP with an explicit CORS allowlist — there's
no shared code, shared types, or shared process between them. If you're
looking for "the single source of truth" for anything, it's always one of:
`backend/src/db/schema.ts` (data model), the route file for a given
feature, or [`CLAUDE.md`](CLAUDE.md) (rules and rationale that don't
belong in code comments) — **not** this file. This file explains how the
pieces fit together and how to run them; it deliberately doesn't restate
exact field/column/route names that drift as the code changes.

### Project lifecycle

A project moves through exactly four states, two of them terminal:

```
draft → submitted → approved
                   → rejected
```

- **`draft`** — the only editable state. A user creates a project, edits
  it freely, picks their Hackatime project(s)/date-range(s), uploads an
  optional showcase photo, and submits when ready.
- **`submitted`** — locked. The record (plus the submitter's fresh
  real-name/address/screenshot, collected at that exact moment) is pushed
  to Airtable as a submission record for a human reviewer. Nothing in the
  app can edit it from here on.
- **`approved` / `rejected`** — decided by a human reviewer in Airtable,
  synced back every few seconds (see [Airtable](#airtable)). Both are final.
- **"need changes"** (a third reviewer outcome, not a project state) — the
  reviewer sets Airtable's Status to `need changes` with a note. That attempt
  is closed, the project goes back to `draft` with a banner showing the note,
  and submitting again creates a new submission and a new Airtable record. A
  project gets 3 attempts in total; "need changes" on the last one becomes a
  final rejection. Use it for fixes that take roughly 30–60 minutes. For a
  two-minute fix the reviewer just DMs the submitter on Slack and leaves the
  status alone. `rejected` is for things that can't or won't be fixed (too much
  AI, duplicate, off-theme), and a rejected project's Hackatime projects and
  repo can't be reused by that person's other projects.

## Repository Structure

```
.
├── backend/              Hono API service (Postgres, Drizzle, Airtable, auth)
│   ├── src/
│   │   ├── routes/       One file per resource (auth, me, projects, gallery, shop, admin, announcements)
│   │   ├── middleware/    CORS, CSRF, rate limiting, security headers
│   │   ├── lib/           Sessions, eligibility logic
│   │   ├── integrations/  Airtable, Hackatime, Hack Club Auth, Hack Club CDN, Slack clients
│   │   ├── jobs/          Scheduled background work (Airtable sync)
│   │   └── db/            Drizzle schema + migration runner
│   └── drizzle/           Generated SQL migrations
├── frontend/              Astro + Svelte site
│   └── src/
│       ├── pages/         File-based routes (Astro)
│       ├── islands/       Interactive Svelte components (popups, forms, the dashboard room)
│       ├── layouts/       Shared page chrome per page "shape"
│       ├── components/    Static Astro components (landing page, docs)
│       ├── content/docs/  Markdown docs content (rendered at /docs)
│       └── lib/           Backend API client, session helpers, eligibility copy
├── docker-compose.yaml    Local Postgres (+ optional full-stack compose)
└── CLAUDE.md              Ground-truth rules/rationale for AI-assisted work on this repo
```

## The Frontend

Astro (mostly server-rendered, plain `.astro` components) with Svelte 5
islands for anything genuinely interactive — popups, forms, the buy
button, the dashboard room itself. Tailwind for styling.

### Pages

File-based routing under `frontend/src/pages/`:

| Route | Purpose |
|---|---|
| `/` | Public landing page |
| `/login`, `/login-blocked`, `/age` | Hack Club Auth login kickoff; "you failed eligibility and never had an account" explainer; age screen for people who aren't ID verified yet |
| `/onboarding` | One-time nickname + "how did you hear about us" wizard, required before anything else |
| `/dashboard` | The whole logged-in app lives here — see [the dashboard room](#the-dashboard-room) |
| `/blocked` | "You have an account but can't participate right now" explainer (banned/ineligible) |
| `/docs/*` | Markdown-driven documentation site, same chrome whether logged in or out |
| `/admin`, `/admin/analytics` | Admin-only panel (announcements, stats, manual sync triggers) |
| `/404` | Themed 404 |

### The dashboard room

`/dashboard` renders a single Svelte island, `islands/room/DashboardRoom.svelte`:
a photo-real "science lab" scene built from absolutely-positioned,
same-canvas-sized PNG layers (`frontend/src/Images/dashboard/`), with a
small mouse-parallax effect and three clickable hotspots (Projects,
Gallery, Shop) that each open a popup island (`ProjectsPopup`,
`GalleryPopup`, `ShopPopup`, all built on the shared `PopupShell.svelte`
skin). A fixed HUD (`DashboardHud.svelte`) sits outside the parallax
layer and never moves — it holds the user's avatar (→ `ProfilePopup`),
a news button (→ `NewsPopup`), a Docs link, and the live moles balance.
A compact stacked layout replaces the whole scene below the `md`
breakpoint, since a parallax photo scene doesn't translate to a small
touch screen.

### Design system

Two visual languages coexist on purpose, not one:

- **The "room" system** — dashboard, admin, onboarding, every popup: wood-
  frame borders, light surfaces, `rounded-none`, Anta for headings. This
  is the app's current identity for anything a signed-in user reaches.
- **The "marketing" system** — only the landing page and `/docs`: lighter,
  flatter, thick-black-border look, its own light/dark toggle.

A page should commit to one system, not blend borders/palettes from both.
Global button hover/press-scale and scrollbar styling are set once in
`app.css`, not re-implemented per component.

### Auth/routing gating

`frontend/src/middleware.ts` resolves the session once per request and
sorts every path into one of three buckets — checked-but-not-required
(`/`, `/login`, `/docs`), protected (`/dashboard`, `/onboarding`, `/admin`
— anonymous visitors bounce to `/login`), or "fall through to Astro's own
routing" (so a genuinely unknown URL still renders the real 404 instead of
a login wall). It also redirects a blocked (banned/ineligible) user to
`/blocked` ahead of onboarding/admin checks, and applies `frame-ancestors
'none'` / `X-Frame-Options: DENY` to every response as clickjacking
defense.

## The Backend

Hono + `@hono/zod-validator` + Drizzle ORM + Postgres, run with `tsx` in
dev and compiled with `tsc` for production. Mounted entirely under `/api`
(see `src/index.ts`) so a reverse proxy can share one domain with the
Astro frontend without route collisions.

Global middleware stack, applied in this order (see `src/index.ts`):
secure headers → CORS → a blanket per-IP rate limit → a CSRF header check
→ session resolution. Every mutating route additionally validates its
body/query with Zod before touching it.

### API Routes

Grouped by file, all mounted under `/api`:

- **`/auth`** — `GET /login` (kicks off the Hack Club Auth OAuth2 flow),
  `GET /callback` (OAuth callback — creates the session, and for a
  brand-new Slack identity, runs the eligibility check *before* writing
  any row), `POST /logout`, `POST /logout-all` (ends every session for the
  user). Only a hash of the session token is stored. The first two carry a tighter rate limit than
  the global default, since they're the routes worth brute-forcing.
- **`/me`** — `GET /` (current user), `PATCH /` (nickname), `POST
  /onboarding`, `GET /hackatime-projects` (proxies the live Hackatime
  stats API, scoped to the caller's own Slack ID), `GET /transactions`
  (the user's own ledger history).
- **`/projects`** — full CRUD for a user's own projects (`GET /`, `POST
  /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`), `GET /:id/submissions`,
  `POST /:id/submit` (the submission flow — live eligibility re-check,
  Zod validation, real-name/address/screenshot collected fresh and
  forwarded straight to Airtable, never stored), `POST /:id/photo` / 
  `DELETE /:id/photo` (showcase photo, via Hack Club's CDN).
- **`/gallery`** — `GET /` (paginated, 24/page; `q`, `status`, `sort`,
  `userId`, `page` — only draft/submitted/approved projects (never rejected) that aren't hidden or
  owned by someone who isn't ID verified or is banned; every gallery route requires a login), `GET /:id` (one project, for deep links), `POST
  /:id/upvote` (idempotent toggle), `POST /:id/view` (undeduplicated counter).
- **`/shop`** — `GET /` (active items), `GET /orders` (a user's own order
  history), `POST /:id/buy` (live eligibility re-check, then: a short
  transaction takes the moles and records a pending order; the Airtable
  fulfillment record is created with no DB connection held; the order is marked
  placed. Shipping info arrives in the same request, is forwarded straight to
  Airtable, and is never stored — if the Airtable write fails the moles are
  refunded, and a crash in between is settled by `jobs/maintenance.ts`).
- **`/admin`** / **`/internal`** — announcement CRUD, dashboard stats,
  signup analytics, the audit trail (`GET /admin/audit`, page `/admin/audit`),
  gallery moderation (`PATCH /projects/:id/hidden`,
  `DELETE /projects/:id/photo`, `POST /users/:id/reset-nickname`), and two
  manual trigger routes
  (`POST /internal/sync/airtable`, `POST /internal/sync/eligibility`) for
  an immediate re-run instead of waiting for the next scheduled tick. All
  admin-only (`requireAuth` + `requireAdmin`).
- **`/announcements`** — `GET /` (with the caller's own read/unread
  state), `POST /:id/read` (toggle).

### Economy

`transactions` is the append-only ledger, and `users.moles_balance` is the
running total the app reads and writes. The two are kept consistent by
rule: a balance only ever changes inside the same DB transaction as a
ledger row explaining why (and the DB refuses a negative balance). Moles are earned in exactly
one place (the Airtable sync job, when a submission's reviewer status is
a plain `"Approved"`) and spent in exactly one place (`POST
/shop/:id/buy`). `moles = floor(approvedHours × 5)`, where a reviewer
types `approvedHours` into Airtable by hand — Cubed never computes or
estimates it — unless the reviewer instead fills in an "override moles"
field, which skips the hours×5 math entirely for cases that don't map
onto an hour count (bonuses, manual corrections). A later edit to an
already-synced Airtable record (e.g. a corrected hour count) is **not**
picked up automatically — a submission is only ever checked while its
local status is `pending`.

### Eligibility gating

A logged-in user can still be blocked from participating for reasons
unrelated to the manual `isBanned` flag: a Hackatime ban
(`trust_level: "red"` from Hackatime's public trust-factor API) or a
rejected / over-18 Hack Club Auth YSWS result. Those hard-block. Someone
who simply isn't ID verified yet (`needs_submission`, `pending`,
`not_found`) is NOT blocked: they get a read-only account (projects, Hackatime,
photos and nickname work; submit, buy and upvote answer 403 `not_verified`),
a banner, and a `user_not_idv` Airtable role. New unverified people answer
an age screen first: 12-or-under / 19+ store nothing at all, 13–18 creates the
account. If Hack Club Auth can't answer for a new person, no account is made.
Everything is checked once at login, then **live** (not on a schedule) at the
two points where it matters — submitting a project and buying from the shop —
via `lib/eligibility-check.ts`'s `checkEligibilityForGate()`, which persists
whatever fresh result it gets before deciding, so a newly-banned user is
blocked on that exact request. A brand-new Slack identity that is hard-blocked
on its very first login never gets a user row or session at all. See the "Eligibility gating" section of [`CLAUDE.md`](CLAUDE.md)
for the full rationale and the frontend-side redirect logic.

### Database

Postgres via Drizzle ORM — `backend/src/db/schema.ts` is the single
source of truth for the data model; nothing else redeclares table shapes.
Notable rules enforced throughout the route layer (see `CLAUDE.md` for
the full list): every mutating response goes through an explicit column
selection (never a raw ORM row or `SELECT *`), every project/order/wallet
query filters by the caller's own `user_id` directly in SQL, and no
physical address/phone/government ID/exact birthdate/legal name is ever
written to a column — that data is collected fresh at
submission/checkout time and forwarded straight to Airtable in the same
request.

## Airtable

Airtable is the external system of record for review decisions and
shop fulfillment — not a cache, and not something the app can treat as
live shared state. A scheduled job (`jobs/airtable-sync.ts`, interval set
by `AIRTABLE_SYNC_INTERVAL_SECONDS`, default 10) pushes nothing — it only
*reads* pending submissions back out of Airtable and applies the result
(credit moles, flip project status) to Postgres. It also mirrors the shop
catalog; items deleted in Airtable are deactivated so they stop being buyable.
The app has no admin/user UI for viewing shop fulfillment status, on purpose —
that answer lives in Airtable exclusively.

**Rate limits.** Every Airtable request is paced at least 220 ms apart (about 4.5 per
second, in memory, one instance) so bursts queue instead of failing. Airtable allows about 5 requests per second per base and
rejects everything for ~30 seconds after exceeding it. Pending submissions are
fetched in batches of 50 (one request per 50, not one each), so a sync run costs
1–2 requests however many are waiting. After any 429 the backend pauses every
background sync for 30 seconds and fails user submits/buys fast with a
"try again" message.

**The submission table.** Each submission is written as one record. Besides the
standard YSWS fields it carries Cubed's own: `ai_declaration`,
`tutorial_declaration`, `user_reviewer_notes`, `user_slack_id`, and a
`Submission History` summary (which attempt this is, earlier attempts, and the
person's other projects). Extra fields are ignored by Hack Club's "Submit to
Unified YSWS" automation, which only reads the fields it names. Reviewers
should fill `Optional - Override Hours Spent` (it is also what Cubed pays
moles from) before setting Status to Approved.

**The Users table.** `jobs/users-sync.ts` mirrors every user into an Airtable
"Users" table and lets the team control access from it: the `role` column
(`user` | `user_not_idv` | `admin` | `banned`) sets admin and ban status in the app within about
30 seconds, `ban_reason` is the team's internal note, and `block_reason` is
written by Cubed with the automatic reason (Hackatime ban, over 18, ...). A row
exists only for someone who already has an account. If Airtable can't be read or
a role is blank, nothing changes. Anyone who can edit that table can make anyone
an admin, so keep its access limited. A banned person sees the "Account
suspended" page.

## External integrations

All four are public/unauthenticated-by-the-end-user or service-account
based — see `backend/src/integrations/`:

- **Hack Club Auth** (`hackclub-auth.ts`) — OAuth2 login, plus a public
  `GET /api/external/check` used for YSWS eligibility/verification/age.
- **Hackatime** (`hackatime.ts`) — a public, unauthenticated stats API,
  keyed by Slack ID: trust-factor (ban status) and per-project
  hours/time-range data (used by the Hackatime project picker when
  submitting).
- **Hack Club CDN** (`hackclub-cdn.ts`) — hosts project showcase photos
  (`HACKCLUB_CDN_API_KEY`; optional — unset just means a 503 from the
  photo routes instead of refusing to boot).
- **Slack** (`slack.ts`) — fetches a user's Slack profile photo at login
  (`SLACK_BOT_TOKEN`, `users:read` scope; also optional, falls back to an
  initial-letter avatar).

## Security model

- Session: an opaque, random (`randomBytes(32)`) token in a `cubed_session`
  **httpOnly** cookie. The database stores only the SHA-256 of the token
  (so a leaked DB can't be replayed), and a ban or "Sign out everywhere"
  deletes the user's sessions. Never a JWT, nothing client-readable.
- CSRF: every mutating request must carry an `X-Requested-With` header,
  enforced globally in `middleware/csrf.ts` ahead of every route mount.
- CORS: an explicit origin allowlist (`FRONTEND_ORIGINS`), never `*`.
- Rate limiting: a blanket per-IP ceiling on everything, a tighter one on
  `/auth/login` + `/auth/callback`. Defense-in-depth only — double-submit
  and double-spend are independently prevented by the project status
  check and a row lock in the buy transaction, with or without a limiter.
- Security headers: the backend (`middleware/security-headers.ts`) sends a
  restrictive `'self'`-only CSP, `X-Frame-Options: DENY`, HSTS and a
  locked-down Permissions-Policy on API responses. The frontend's
  middleware sets `frame-ancestors 'none'`, `X-Frame-Options`, HSTS and
  `nosniff` on pages; in production it also sends a page CSP (`default-src 'self'`,
  `connect-src` limited to the API origin, `object-src 'none'`, ...). Its
  `script-src` still allows `'unsafe-inline'` because Astro's island
  hydration and `<ClientRouter />` are inline (Astro's hash-based CSP doesn't
  support `<ClientRouter />`).
- All SQL goes through Drizzle's query builder or parameterized `sql`
  tagged templates — never string-concatenated SQL.

## Getting Started

### Prerequisites

- Node.js ≥ 22.12
- Docker (for local Postgres via `docker-compose.yaml`) — or any Postgres
  16 instance you point `DATABASE_URL` at
- A Hack Club Auth OAuth app ([auth.hackclub.com/developer/apps/new](https://auth.hackclub.com/developer/apps/new))
- An Airtable base with a Personal Access Token

### Install

```bash
docker compose up -d postgres
cd backend && npm install
cd ../frontend && npm install
```

### Environment Variables

Copy each service's example file and fill in real values — neither
`.env` is ever committed (see each service's own `.gitignore`):

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

`backend/.env.example` documents every variable the backend reads
(database URL, Hack Club Auth app credentials, Airtable base/table/field
IDs, the optional Slack bot token and Hack Club CDN key). `frontend/.env.example`
holds only non-secret config — the backend's URL from both the server
(SSR) and the browser's point of view — since everything in it ships to
the browser verbatim for any `PUBLIC_`-prefixed variable.

### Run

With Postgres already up (`docker compose up -d postgres`):

```bash
# backend — http://localhost:8787
cd backend && npm run dev

# frontend — http://localhost:4321
cd frontend && npm run dev
```

`docker-compose.yaml` can also run the full stack (`docker compose up`)
using each service's own `Dockerfile` and `.env`, for a closer-to-prod
smoke test.

### Database Migrations

Drizzle generates plain SQL migration files from schema changes:

```bash
cd backend
npm run db:generate   # diff schema.ts against the last migration, write a new .sql file
npm run db:migrate    # apply any unapplied migrations
npm run db:studio     # Drizzle Studio, a GUI over the local database
```

Never hand-edit a generated migration or the data model elsewhere —
`backend/src/db/schema.ts` + the files under `backend/drizzle/` are the
only source of truth.

### Deploying

- Run migrations BEFORE starting the new backend version: `node dist/db/migrate.js` from the
  backend image (or `npm run db:migrate` from source). The image does not do it for you.
- Backend env: `NODE_ENV=production`, `TRUSTED_PROXIES`, `COOKIE_SIGNING_SECRET` (32+ chars),
  https URLs everywhere (see `backend/.env.example`); it refuses to start otherwise.
- Frontend: `PUBLIC_BACKEND_URL` is a Docker BUILD arg (baked into the browser bundle);
  `BACKEND_URL` is a normal runtime variable. Serve frontend and backend from ONE host
  (for example `/api` routed to the backend) so the host-only session cookie works.
- Health: backend `/api/livez` (process up, never touches the database) and `/api/readyz`
  (database reachable); frontend `/healthz`. None of them are rate limited.
- On SIGTERM the backend lets in-flight requests finish for up to 25 s; give the container a
  stop grace period of at least 30 s.
- Every page response is `Cache-Control: no-store` (pages differ per person); only `/_astro/*`
  build assets are cacheable.

## Contributing

Read [`CLAUDE.md`](CLAUDE.md) before making a change that touches money,
PII, or auth — it documents the non-negotiable rules and the reasoning
behind decisions that aren't obvious from the code alone (why there's no
resubmit path, why Airtable sync is one-directional, why eligibility is
checked live instead of on a timer, etc.). If something in that file
turns out to contradict the actual code, the code wins — fix the file,
don't trust the doc.
