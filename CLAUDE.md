# CLAUDE.md — ground truth for this codebase

This is the only spec file for this project — the `docs/` folder that used
to hold `PRODUCT.md`/`ARCHITECTURE.md`/`SECURITY.md`/`DESIGN.md` is gone on
purpose (it had drifted from the actual code and was actively misleading).

**Keep this file honest.** Only add something here if it's a rule or a
piece of non-obvious rationale that won't go stale on its own — the reason
a decision was made, not a description of what the code already says for
itself. Table columns, route lists, and exact field names belong in the
code (`backend/src/db/schema.ts`, the route files) — read those directly,
don't restate them here, since restating them is exactly what rotted last
time. If you (a human or a future Claude) discover this file contradicts
the actual code, the code wins — fix the file, don't trust the doc.

## Stack
- Frontend: `/frontend` — Astro (mostly plain Astro components) + Tailwind +
  TypeScript, with Svelte islands only for the genuinely interactive bits
  (popups, buy button, live forms). Two coexisting visual languages, not
  one — see "Design system" below.
- Backend: `/backend` — Hono + Zod (`@hono/zod-validator`) + Drizzle ORM +
  Postgres. Separate deployable service from the frontend — CORS between
  them is explicit, not same-origin by default.
- Auth: Hack Club Auth (OAuth2 authorization-code flow), opaque session
  token in a `cubed_session` httpOnly cookie, `sessions` table.
- External system of record for reviews/shop fulfillment: Airtable. See
  "Airtable sync" below for the exact shape of that relationship — it's
  more specific than "synced periodically."
- Participation eligibility (Hackatime ban status, Hack Club Auth YSWS
  eligibility/verification/age) comes from two more external, unauthenticated
  Hack Club APIs — see "Eligibility gating" below.

## Non-negotiable rules
1. Never persist physical address, phone number, government ID, exact
   birthdate, or legal name in Postgres. That data is collected fresh at
   submission/checkout time, forwarded straight to Airtable in the same
   request, and never written to a column. If a feature seems to need it
   in Postgres, stop and ask — don't just add the column.
2. `transactions` is append-only. Balance changes happen only inside the
   same DB transaction as a `transactions` insert — never edit a balance
   without a matching ledger row explaining why.
3. Every route handler validates input with Zod first. No handler touches
   `req.json()`/params/query directly without a schema.
4. Every project/order/wallet handler filters its DB query by
   `user_id = session.user.id` directly in the `WHERE` clause — never
   "fetch by id then check ownership in JS after."
5. Status-locked fields (project edits after submit) are enforced in the
   backend, not just the UI. `EDITABLE_STATUSES` in
   `backend/src/routes/projects.ts` is the actual current list — check it,
   don't assume. As of now it's `["draft"]` only — once a project is
   submitted, it's locked until the reviewer decides. A reviewer's "need
   changes" reopens it as a draft (see "Project lifecycle" below); "rejected"
   and "approved" stay final.
6. Never `SELECT *` / return a raw ORM row as the API response. Every
   response goes through an explicit column selection.
7. All DB access goes through Drizzle's query builder or parameterized
   `sql` tagged templates — never string-concatenated SQL, anywhere.
8. Mutating POST/PATCH/DELETE requests require an `X-Requested-With`
   header (a lightweight CSRF check) — match the existing fetch helpers
   instead of hand-rolling a new request.
9. A correlated subquery needs its columns spelled out as literal,
   pre-qualified SQL text (`table.column`) instead of interpolated Drizzle
   column objects, whenever the outer query has no JOIN and there's any
   shared column name (like `id`) between the two tables — Drizzle has
   silently emitted an unqualified, wrongly-resolved comparison here before
   (see the `upvoteCount`/`projectColumnsWithUpvotes` subquery in
   `projects.ts` for a worked example and the full postmortem in its
   comment).
10. If you're about to make an assumption that affects money, PII, or auth,
    surface it and ask instead of guessing. This has come up for real
    (crediting rules for a fast-tracked Airtable review status, whether a
    rejection should be resubmittable) — always worth a question, never
    worth a guess.

## Domain model
- **Project lifecycle**: `draft → submitted → (approved | rejected)`, with
  one loop. Reviewers have three outcomes in Airtable's Status: **Approved**
  (pays moles), **need changes** ("fix this and try again": 30–60 minutes of
  work) and **rejected** (final: too much AI, duplicate, off-theme, or
  anything that can't or won't be fixed). Tiny fixes (a README tweak, repo
  visibility) are still handled by a Slack DM with the status left alone.
  - **need changes** isn't a project status: the sync closes that attempt
    (`submissions.status = changes_requested`, the reviewer's user-facing note
    stored as feedback) and flips the project back to `draft`, where the
    owner sees a banner with the note. Submitting again creates a NEW
    submission and a NEW Airtable record (nothing reviewer-owned is ever
    overwritten); an old record that already got "need changes" is closed — a
    later change to it in Airtable is ignored. Review history shows every
    attempt.
  - **3 attempts per project** (`MAX_SUBMISSION_ATTEMPTS`). A "need changes"
    on the last allowed attempt becomes a final rejection (the note kept).
    Only one submission per project can be pending at a time (partial unique
    index).
  - **Rejected is permanent, and so is its work**: a new project by the same
    person can't use a Hackatime project or repo link (compared normalized)
    that one of their rejected projects used (`lib/reuse-block.ts`, checked on
    create, edit and submit). Retries after need changes stay on the same
    project and are exempt.
  - Every submission writes a "Submission History" text field to Airtable
    (attempt N of 3, earlier attempts on the project, and up to 5 of the
    person's other projects with outcomes/notes — `lib/submission-history.ts`),
    plus `tutorial_declaration` (a MANDATORY yes/no — no default, can't be
    skipped — and when yes the tutorial link, how closely they followed it and
    what they added themselves are all required). Extra fields on the
    Airtable submission table are ignored by the Unified push script.
- **YSWS submission format** (Hack Club's "YSWS Project Submission Guidelines"): the
  Hackatime justification is exactly `name M/D/YYYY-M/D/YYYY, name2 ...` (unpadded US
  dates, comma-joined) and the Hackatime ID is the numeric one; the screenshot must be a
  STILL image (no GIF, animated WebP or APNG — checked on the file's real bytes);
  Birthday is a real YYYY-MM-DD date. Reviewer-owned fields (Status, Optional - Override
  Hours/Moles/Justification) are never written — the Unified automation combines the
  Justification fields itself. When pointing the app at a different Airtable base, its
  submissions table must contain every field we write (incl. our custom `ai_declaration`,
  `tutorial_declaration`, `Submission History`, `user_reviewer_notes`) and
  `Optional - Override Approved Moles`, or submits fail with an unknown-field 422.
- **Moles economy**: `transactions` is the only source of truth for a
  balance. Moles are earned in exactly one place — the Airtable sync job,
  when a submission's reviewer status is a plain `"Approved"` (NOT
  `"approved (no fraud review)"`, which is treated as still-pending and
  re-checked later, never auto-credited) — and spent in exactly one
  place — `POST /shop/:id/buy`. `moles = floor(approvedHours × 5)`, where
  `approvedHours` is a number the reviewer types into Airtable by hand;
  Cubed never computes or estimates it. A reviewer can instead fill in
  Airtable's "Optional - Override Approved Moles" field to credit an exact
  mole amount directly, skipping the hours×5 math entirely — an escape
  hatch for cases that don't map onto an hour count (bonuses, manual
  corrections). `approvedHours` is still recorded on the submission either
  way, but is purely informational once a moles override is used — moles,
  not hours, is always the actual source of truth for the ledger entry.
- **Airtable sync is one-way in each direction, and it's a scheduled batch
  job, not a live cache** — nothing lingers in server memory between runs.
  It fires on a plain `setInterval` (default 10 s, see
  `AIRTABLE_SYNC_INTERVAL_SECONDS`; a run is skipped if the previous one is
  still going), does a handful of DB queries + Airtable API calls, and
  finishes. Pending submissions are fetched in batches of 50 (one request per
  50, not one each), so a run costs 1–2 requests however big the backlog.
  Airtable allows ~5 req/s per base and rejects EVERYTHING for ~30 s after a
  429, so every request is first paced >= 220 ms apart (one in-memory queue in
  `integrations/airtable.ts`, so single backend instance only; a queue that would
  wait > 8 s fails fast), and after any 429 `integrations/airtable.ts` pauses all background syncs
  for 30 s and makes user-facing writes fail fast with a retryable error. Shop
  items deleted in Airtable get deactivated (never deleted — orders reference
  them), so they stop being buyable. A submission is only ever checked while its
  local status is `pending` — once synced to a final state it's never
  re-checked, so a later edit to that same Airtable record (e.g. a
  corrected hour count) won't be picked up automatically.
- **Submitting is claim-first.** `handleSubmission` flips the draft to
  `submitted` with a conditional UPDATE *before* any Airtable call (so two
  clicks can't both create PII-bearing records), and on failure deletes the
  half-made Airtable record and flips the project back to draft. The claim runs under
  a per-user advisory lock and re-checks the hours-overlap rule there, so two projects
  sharing a Hackatime project can't both slip through by being submitted together. The
  record's "Submission History" ends with `Cubed ref: <projectId>`: if Airtable's answer
  never arrives (timeout/5xx — it may STILL have created the record), a `sweep:` row in
  `airtable_cleanup` looks the record up by that marker a few minutes later and deletes
  it if no submission row owns it. A cleanup delete is always queued BEFORE the local
  row is removed. PATCH
  re-checks `status` inside its UPDATE's WHERE. The one-pending-submission
  partial unique index on `submissions.project_id` backs this up. The Hackatime user ID is never
  accepted from the client — PATCH verifies the selected project names
  against the caller's own Hackatime account and sets the ID from that lookup.
- **Only the exact status `rejected` rejects.** Any status the code doesn't know (a new
  reviewer option like "2nd pass", or a typo) leaves the submission pending and is logged
  once; teams can add statuses without anything being rejected by accident. The status
  sync requests only the four fields it reads (`SUBMISSION_SYNC_FIELDS`), never the
  address/birthday columns — and renaming one of those columns makes the sync fail loudly
  (422) rather than misread. A pending record that is missing from Airtable for over a
  day, while other records are found, is reopened as a draft (audit-logged); an empty
  result never reopens anything. The manual "sync now" buttons share a lock with the
  timers (`lib/exclusive.ts`).
- **Airtable sync edge cases.** An `Approved` status with no hours and no
  moles override (or a negative value) stays pending instead of crediting 0;
  one bad record can't stall the rest; shop items with a missing/non-positive
  `cost_moles` stay inactive (Airtable omits blanks and unticked checkboxes,
  so a missing key means blank/false, never a default).
- **Buying is one request, in three steps.** `POST /shop/:id/buy` takes the quantity
  AND the shipping info. (1) A SHORT transaction (user row locked, so two buys can't
  spend the same moles) records a `pending` order and takes the moles. (2) The Airtable
  fulfillment record is created with NO database connection or lock held (an Airtable
  call inside a transaction could exhaust the connection pool); its internal `notes`
  field carries `Cubed order <id>`. (3) The order becomes `placed`. If step 2 DEFINITELY
  failed (never sent, or Airtable answered 4xx) the moles are refunded at once (ledger
  `adjustment`, order `refunded`). A timeout or 5xx proves nothing (the record may exist
  and the prize ship), so the order stays `pending`, the buyer gets 502
  `fulfillment_unconfirmed`, and the reconciler decides (`integrations/airtable.ts`
  `isDefiniteFailure`). A crash in between likewise leaves a
  `pending` order that `jobs/maintenance.ts` settles by finding the record via that marker
  (placed) or refunding. Shipping info can't be kept for retries (PII), hence the refund.
  The UI collects shipping first, shows a summary, and charges only on "Confirm purchase."
- **Fulfillment (shop shipping info) has no admin or user UI, on purpose.**
  It's forwarded straight to Airtable and lives there exclusively — this
  app cannot answer "what orders still need to be shipped." Don't add a
  view for this without an explicit ask.
- **Legal identity vs. in-app identity are deliberately separate.** A
  user's `nickname` is never derived from or synced with their real name —
  the real name is only ever collected fresh, per submission/order, and
  discarded after forwarding to Airtable.
- **Gallery is dashboard-only, not a public page.** There used to be a
  standalone `/gallery` route reachable while logged out — it's been
  deleted. Browsing the gallery now only happens through the Gallery
  popup inside the dashboard room, which means it requires login. That
  still holds for "view all of one user's projects" (click a submitter's
  pfp in the detail view, or load `/dashboard?userId=<id>` directly) — it's
  an in-popup mode of the same login-gated Gallery, not a new public route.
- **What the Gallery shows**, enforced once backend-side in `gallery.ts`
  (never trusted to frontend filtering; every gallery route requires a login since the
  data is about minors): `draft`, `submitted` and `approved` projects (drafts are public on purpose —
  a product decision) — never rejected ones, not behind a filter, not in the
  per-user view — that aren't
  `hidden` by an admin and whose owner is ID verified (`yswsStatus ===
  "verified_eligible"`) AND not banned (`isBanned` or `hackatimeBanned`).
  Projects of banned, unverified, rejected or over-18 owners all disappear
  (and come back if the person is unbanned/verified); the view counter obeys
  the same rule. Admins also see hidden ones (flagged) so they can unhide
  them. The list is server-paginated (24/page) and search/sort/status/userId
  run server-side. `GET /projects` (a user's own list) is unaffected and shows
  every status — that's the owner managing their own work.
- **Moderation** lives in the Gallery detail view for admins (hide/unhide a
  project, remove its photo, reset a nickname to a neutral `user_xxxxxx`) —
  there is no separate admin page for it. Nicknames are unique
  case-insensitively (DB index). The showcase photo is draft-only: it can't
  change after submit. Per-user caps: at most 6 open DRAFTS at once (no cap on total
  projects — submitting frees a slot; checked under a per-user lock) and 10 photo
  uploads/hour (in-memory, single-instance like the rate limiter). A draft that already
  went through a review round can't be deleted (it holds the attempt count and the
  reviewer's notes; deleting it would hand out fresh attempts).
- **Hackatime hours are always counted from June 1 (`config.programStartDate`)
  to Nov 10 (`config.programEndDate`), the same window for everyone.** Users never pick dates: the client sends only project names, the
  backend verifies them against the caller's own Hackatime account, builds the
  date range itself, and re-verifies at submit. The total tracked time of the selected projects is snapshotted
  into `projects.hackatime_seconds` (on selection and again at submit, from the
  same verified lookup — never client-supplied) and shown on Gallery cards and the
  detail view; NULL (no Hackatime project picked) shows as "0h 0m".
  **The same hours can't be paid twice:** a project can't be submitted if one of the
  person's other projects that is pending review or approved already uses one of its
  Hackatime projects (`lib/hours-overlap.ts`, 409 `hours_in_use`); overlaps with drafts
  are only flagged to the reviewer in Submission History ("Hackatime project X also used on
  project Y"). Two drafts may still pick the same Hackatime project.
- **Sessions**: only a SHA-256 of the cookie token is stored (`sessions.id`), so
  a leaked database can't be replayed as live logins. Sliding: 14 idle days (renewed at
  most daily on use), 90 days absolute. Banning a user (or "Sign out everywhere")
  deletes all their sessions. The signup cookie is signed with `COOKIE_SIGNING_SECRET`.
- **Rate-limit client IP**: `X-Real-IP` is only believed when the direct peer is in
  `TRUSTED_PROXIES` (`lib/client-ip.ts`); otherwise the socket address is used, so a client
  can't pick its own bucket. Required outside development (`*` = trust every peer, only
  if the backend is reachable solely via the ingress/frontend).
- **Free text is cleaned** (`lib/text.ts`): control, invisible and bidi characters and
  zalgo are stripped from every typed field, and values written to Airtable that start
  with `=`, `+`, `-` or `@` get a leading apostrophe so exports can't run them as formulas.
- **Submitting saves the Airtable link first** (before the screenshot upload), a stuck
  `submitted` project with no submission is reopened as a draft after 10 min, and an
  Airtable record that couldn't be deleted during a rate-limit pause is queued
  (`airtable_cleanup`, ids only) and deleted later — the PII never lingers.
- **Audit log** (`admin_actions`, `lib/audit.ts`, shown to every admin at `/admin/audit`):
  announcements, hide/unhide, photo removal, nickname resets, manual syncs, role/ban
  changes from Airtable, and automatic recoveries/refunds. Append-only; writing it never
  blocks the action. Errors are logged without their query parameters (no PII in logs).

## Admin metrics
`/admin/analytics` (`routes/admin-analytics.ts`, page `frontend/src/pages/admin/analytics.astro`) is
read-only and UTC. **DAU** = people with Hackatime time that UTC day on a linked
project that isn't rejected (`hackatime_activity`, seconds per user per day, filled hourly by
`jobs/hackatime-activity.ts` from Hackatime's public spans endpoint; a user's whole history
since program start is rebuilt whenever their set of linked names changes). **Visitors** come
from `users.last_seen_at` (throttled to ~2 min) and `user_activity` (one row per user per UTC
day, nothing about what they did), both written fire-and-forget in `attachSession`, so visitor
history only starts when that tracking started. "Hours" are the `projects.hackatime_seconds`
snapshots, not live Hackatime data. The activation funnel counts users who EVER did each step,
not a strict sequence.

## Users table (Airtable) — admin and manual bans
`jobs/users-sync.ts` mirrors users into an Airtable "Users" table (enabled by
`AIRTABLE_USERS_TABLE_ID`, checked every `AIRTABLE_USERS_SYNC_INTERVAL_SECONDS`,
default 30) and reads the team's decisions back. Ownership is per field:
- **Cubed writes** id, slack_id, username (the nickname), Email, hackatime_id,
  signed_up_at, `block_reason` (the AUTOMATIC reason: Hackatime ban / not
  eligible / over 18 / needs verification — it clears itself) and last_sync_at;
  and `role` when the row is first created, plus the `user` ↔ `user_not_idv`
  flip whenever someone's ID verification changes (those two values are
  Cubed-managed; the sync never touches a role set to admin or banned).
- **The team edits** `role` (user | user_not_idv | admin | banned) and `ban_reason`
  (internal, never shown to the user). `role` drives `users.is_admin` /
  `users.is_banned`; a manual SQL flip of those columns is overwritten within a sync.
- A row exists only for someone who already has an account — a first-time
  signup that is hard-blocked, or that answers 12-or-under / 19+ on the age
  screen, never gets one. Existing admins/bans are copied
  into Airtable first, so enabling it never demotes anyone.
- Fail-safe: if Airtable can't be read, a row is missing, or `role` is blank or
  unrecognised, nothing changes. Anyone with edit access to this table can make
  anyone an admin — keep it restricted.
- A banned user's sessions are kept and answer 403 `{error:"suspended"}`; the
  frontend sends them to `/suspended` (a fixed message: suspended by the team,
  "message the Cubed team on Slack"). Lifting the ban deletes their sessions.

## Newsletter audience (Airtable "Loops" table)
`jobs/loops-sync.ts` (enabled by `AIRTABLE_LOOPS_TABLE_ID`) keeps one row per account in a table that Hack Club's
own Loops sync reads; nobody at Hack Club uses the Loops API directly. EVERY account is added (a product decision:
nobody opts in, the email's unsubscribe link is the opt-out, and banned or not-verified people are included on purpose).
Cubed owns every column and writes only the email, its own user id and activity timestamps (signup, onboarded, first
project, first submission, first approval, first order, last login at day precision) — never names or addresses.
The timestamp columns become Loops contact attributes, so once the program slug is known they must be named
`Loops - <slug>SignUpAt` etc. and `LOOPS_PROGRAM_SLUG` set at the same time (a rename without the env var, or the
reverse, makes every sync fail with an unknown-field 422). The "Loops List - <name>" formula column that subscribes rows
to the list is added by hand by whoever owns the Loops side; Cubed never writes it.

## Eligibility gating
A user can be logged in (real session, passed onboarding) but still blocked
from participating, for reasons that have nothing to do with `isBanned` (the manual team ban,
controlled from the Airtable Users table's `role` — see "Users table" below):
- **Hackatime ban**: `users.hackatimeBanned`, from Hackatime's public
  `GET /api/v1/users/{slackId}/trust_factor` (`trust_level: "red"` → banned;
  `"blue"`/`"green"` → fine). No auth needed, keyed by Slack ID.
- **YSWS eligibility/verification/age**: `users.yswsStatus`, from Hack Club
  Auth's public `GET /api/external/check?slack_id=` — also no auth needed.
  Its `result` value is stored close to verbatim (see the `ysws_status` enum
  in `schema.ts`); `"rejected"` and `"verified_but_over_18"` both HARD-block
  (and so does a Hackatime ban). Everything that isn't `"verified_eligible"`
  (`needs_submission`, `pending`, `not_found`, or never checked) is simply
  **not ID verified** — NOT a block (see below).
**Not ID verified is a read-only mode, not a block** (`isIdVerified()` in
`lib/eligibility.ts`). Those people get an account and can explore, set a
nickname, create/edit drafts, pick Hackatime projects and upload photos, but
cannot submit, buy or upvote (`not_verified` 403 from `checkEligibilityForGate`
on submit/buy and `requireVerified` on upvote). Each blocked attempt, and the
dashboard banner shown whenever they're logged in, says: "You aren't ID
verified! You can still explore the platform, but please verify your identity
in Hack Club Auth to submit your project or get prizes." The banner's "I've
verified" button re-checks Hack Club Auth immediately. Their projects never
appear in the Gallery, and their Airtable Users `role` is `user_not_idv`
(Cubed flips it to `user` when they verify; admin/banned stay the team's).
**New unverified people see an age screen first** (`/age`, backend
`POST /auth/age`): "12 or under" and "19 or older" create NOTHING — no row, no
session, nothing in Airtable — and only set a browser-side cookie so that same
browser isn't re-asked for a day; "13–18" creates the account and stores only
`users.age_declared_at` (the legal record of the declaration). Between the
login callback and the answer, their identity lives in a short-lived signed
cookie (`lib/signup-cookie.ts`), never in our database. If Hack Club Auth's
check can't answer for a brand-new person, no account is made ("try again in a
few minutes"); existing accounts keep their stored status through a hiccup.
**First login for a Slack identity vs. an existing account are handled
completely differently, on purpose:**
- **Never logged in before, fails the check**: `routes/auth.ts` looks the
  Slack ID up *before* writing anything. If there's no existing row and
  eligibility fails, nothing is ever inserted — no user row, no session,
  not even a partial one to later flip a flag on. It redirects straight to
  `/login-blocked?reason=...` (a query param is fine here specifically —
  there's no account and no stored data for a spoofed value to leak or
  misrepresent, unlike everywhere else in this app that avoids query-param-
  driven state for exactly that reason).
- **Existing account, fails the check later** (or already had on a prior
  login): keeps their row — `hackatimeBanned`/`yswsStatus` are updated like
  any other field, they just can't do anything with the account anymore.
  Gated in `frontend/src/middleware.ts`, ahead of the onboarding check,
  redirecting to `/blocked`, which (unlike `/login-blocked`) picks its copy
  from `Astro.locals.user`'s real fields, not a query param.
**Not a scheduled background job — checked live, at login and at the two
real "gates."** Both fields are set once at login (`routes/auth.ts`), then
re-checked live by `lib/eligibility-check.ts`'s `checkEligibilityLive()` at
the exact two points where it actually matters: submitting a project
(`POST /projects/:id/submit`) and buying from the shop (`POST
/shop/:id/buy`). Each call persists whatever fresh result it gets before
deciding, so a newly-banned user is blocked on that very request (403
`{error: "not_eligible", reason: "..."}`) and correctly redirected to
`/blocked` on their next page load too — not just eventually, on some
timer. There used to be a `jobs/eligibility-sync.ts` scheduled `setInterval`
doing this on a 24h cycle for every user; that's gone (a 30-day session
could easily outlive a same-day ban, which was the whole reason it existed)
in favor of only ever calling Hackatime/Hack Club Auth when a user is
actually about to do something that matters. `syncEligibility()` itself
still exists, but only as a manual admin action (`POST
/admin/internal/sync/eligibility`) for a bulk recheck, not on a timer.
The submit/buy gates use `checkEligibilityForGate()`, which **fails closed**:
if the YSWS status is still unknown (Hack Club Auth unreachable and nothing
stored) they return 503 `eligibility_unverifiable` instead of letting the
request through (a known-but-unverified status gets `not_verified` instead).
Page gating (frontend middleware) stays fail-open on purpose. Project
create/edit/photo routes use the stored flags via `requireNotBlocked`, so a
banned user can't keep working through the API. `/blocked` re-checks live on
load (`POST /me/recheck-eligibility`), so someone who got unbanned or verified
gets back in without anyone touching the database.
`/blocked` and `/login-blocked` share their reason-priority order and copy
via `frontend/src/lib/eligibility-copy.ts` — and since backend/frontend are
separate deployables with no shared code path, `backend/src/lib/eligibility.ts`
duplicates just the reason-priority function (also reused by
`lib/eligibility-check.ts`); keep both in sync by hand.

## Design system — two coexisting visual languages
This app has TWO separate design systems in play at once, not one. Know
which page you're in before styling anything:
- **The "room" system** (dashboard, admin, onboarding, and every popup —
  Shop/Gallery/Projects/Inbox/Profile): wood-frame borders (`#5c4429`),
  light green surfaces (`#cfe0d5`), `rounded-none`, the blurred `bg.png`
  room render as a background, Anta for headings. This is the app's actual
  current identity for anything a signed-in user reaches.
- **The "marketing" system** (only the landing page at `/` now — the
  thick-black-border/grid-background `AppLayout` look is otherwise only
  used by `/docs`): lighter, flatter, has its own light/dark mode toggle.
  Don't blend the two — a page should commit to one or the other, not mix
  borders/palettes from both.
- A global button gets a subtle hover/press scale for free (see `app.css`'s
  `button:not([data-no-hover-scale])` rule) and every scrollable box gets a
  thin translucent scrollbar (same file) — both are set once, globally,
  not per-component. Don't re-implement either locally.

## Auth/routing gating
`frontend/src/middleware.ts` resolves the session for every request and
has three buckets, not two:
- `CHECK_BUT_DONT_REQUIRE_*` (`/`, `/login`, `/docs`) — session resolved if
  present, never required.
- `PROTECTED_PREFIXES` (`/dashboard`, `/onboarding`, `/admin`) — anonymous
  visitors get redirected to `/login`.
- Everything else — falls through to Astro's own routing, so a genuinely
  broken/unknown URL renders the real themed 404 instead of a login wall.
Keep this distinction if you add a new route: decide which bucket it
belongs in, don't just default to "protected."

## When implementing a feature
- Read the actual schema/route file for exact column/field names — this
  doc deliberately doesn't restate them, and won't be kept in sync if you
  add one here instead.
- Before marking a route "done": Zod validation, ownership filter in SQL,
  explicit response shape, and the CSRF header check above — not just
  "it works when I click it."
- If a change touches money, PII, or auth and the right behavior isn't
  obvious from the code or from what's already been said, ask — don't
  guess and don't default to the most permissive option.
- Navigate between pages that should fade into each other with Astro's
  `navigate()` (from `astro:transitions/client`), not a raw
  `window.location.href` assignment — the latter is a real browser
  navigation that skips Astro's transition system even if both pages
  include `<ClientRouter />`.

## Repo layout
`/frontend` and `/backend` are separate deployable services, each with
their own `package.json`/`.env`. Drizzle schema + migrations live in
`backend/src/db/` — that's the single source of truth for the data model;
nothing else should redeclare table shapes.

## Code comments
- Comment to explain *why*, not *what*. If the code is self-evident, no comment.
- **Keep** comments that carry: non-obvious constraints/invariants, workarounds for bugs/limitations, cross-file sync obligations, context that lives outside the codebase (ticket IDs, policy refs, Airtable/external-system field configs), or a one-line summary on public/exported functions.
- **Never** write: narration of what the code does, restatements of names/types/signatures, change-log notes, block-end markers or section dividers, or a comment restating a decision the code already reflects.
- Max 2 lines per inline comment. For a genuinely crucial explanation that can't be compressed that far, it's allowed to run longer — but treat that as a rare exception, not a default, and still cut it to the barest version of the fact, not a full walkthrough.
- When editing existing code, don't add new comments to lines you didn't change.