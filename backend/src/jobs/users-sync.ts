// Mirrors users into the Airtable "Users" table and reads admin/ban decisions
// back out of it. Ownership is per field, so the two directions never fight:
//
//   Postgres → Airtable: id, slack_id, username, Email, hackatime_id,
//     signed_up_at, block_reason (the automatic Hackatime/eligibility reason),
//     last_sync_at — and `role` ONLY when the row is first created.
//   Airtable → Postgres: `role` (user | admin | banned) → users.is_admin /
//     users.is_banned. ban_reason is written by the team, never by this job.
//
// A row is created only for someone who already has a Cubed account, so a
// first-time signup that fails eligibility never shows up here. Safety: if
// Airtable can't be read, a row is missing/deleted, or `role` is blank or
// unrecognised, nobody's role changes — a glitch can never demote or unban
// anyone. Anyone who can edit this table can make anyone an admin, so keep
// its access limited.

import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { projects, users } from "../db/schema.js";
import { airtableCoolingDown, createRecords, listRecords, updateRecords } from "../integrations/airtable.js";
import { deleteAllSessionsForUser } from "../lib/session.js";
import { eligibilityBlockReason, isIdVerified, type BlockReason } from "../lib/eligibility.js";
import { config } from "../config.js";
import { logAdminAction } from "../lib/audit.js";
import { runExclusive } from "../lib/exclusive.js";

// user_not_idv = a normal member who hasn't finished ID verification (read-only
// until they do). It is Cubed-managed: this job flips a row between "user" and
// "user_not_idv" as their verification changes. admin and banned are the team's.
type AirtableRole = "user" | "user_not_idv" | "admin" | "banned";

const BLOCK_REASON_LABEL: Record<BlockReason, string> = {
  hackatime_banned: "Hackatime banned",
  rejected: "Not eligible for YSWS",
  over_18: "Over 18",
};
const NEEDS_VERIFICATION_LABEL = "Needs verification";

const text = (value: unknown) => (value == null ? "" : String(value).trim());
const day = (date: Date) => date.toISOString().slice(0, 10);

function dbRole(user: { isAdmin: boolean; isBanned: boolean; yswsStatus: Parameters<typeof isIdVerified>[0] }): AirtableRole {
  return user.isBanned ? "banned" : user.isAdmin ? "admin" : isIdVerified(user.yswsStatus) ? "user" : "user_not_idv";
}

const warnedDuplicates = new Set<string>();
function warnDuplicate(id: string) {
  if (warnedDuplicates.has(id)) return;
  warnedDuplicates.add(id);
  console.warn(`Users sync: more than one Airtable row for user ${id}; using the oldest. Delete the extra row.`);
}

export async function syncUsers() {
  const tableId = config.airtable.usersTableId;
  if (!tableId) return;

  // Read first: if this throws nothing below runs, so no role can change.
  const records = await listRecords(tableId);

  // Airtable lists rows in view order, not creation order. If a person ever ends up with
  // two rows, always treat the OLDEST as the real one so the choice is stable.
  records.sort((a, b) => (a.createdTime ?? "").localeCompare(b.createdTime ?? ""));

  const byId = new Map<string, (typeof records)[number]>();
  const bySlack = new Map<string, (typeof records)[number]>();
  for (const record of records) {
    const id = text(record.fields.id);
    const slack = text(record.fields.slack_id);
    if (id && byId.has(id)) warnDuplicate(id);
    if (id && !byId.has(id)) byId.set(id, record);
    if (slack && !bySlack.has(slack)) bySlack.set(slack, record);
  }

  const dbUsers = await db
    .select({
      id: users.id,
      slackId: users.slackId,
      email: users.email,
      nickname: users.nickname,
      isAdmin: users.isAdmin,
      isBanned: users.isBanned,
      hackatimeBanned: users.hackatimeBanned,
      yswsStatus: users.yswsStatus,
      createdAt: users.createdAt,
    })
    .from(users);

  // Most recent Hackatime user id the person has attached to any project.
  const hackatimeRows = (await db.execute(sql`
    select distinct on (user_id) user_id, hackatime_user_id
    from ${projects}
    where hackatime_user_id is not null
    order by user_id, updated_at desc
  `)) as unknown as { user_id: string; hackatime_user_id: string }[];
  const hackatimeByUser = new Map(hackatimeRows.map((r) => [r.user_id, r.hackatime_user_id]));

  const toCreate: Record<string, unknown>[] = [];
  const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];
  // Date only: Airtable's plain "date" fields reject a full ISO datetime (verified
  // against the real table), and a dateTime field accepts a bare date too.
  const now = day(new Date());

  for (const user of dbUsers) {
    const record = byId.get(user.id) ?? bySlack.get(user.slackId);

    const blockReason = eligibilityBlockReason(user.hackatimeBanned, user.yswsStatus);
    const blockLabel = blockReason
      ? BLOCK_REASON_LABEL[blockReason]
      : isIdVerified(user.yswsStatus)
        ? ""
        : NEEDS_VERIFICATION_LABEL;
    const desired: Record<string, string> = {
      id: user.id,
      slack_id: user.slackId,
      username: user.nickname ?? "",
      Email: user.email,
      hackatime_id: hackatimeByUser.get(user.id) ?? "",
      signed_up_at: day(user.createdAt),
      block_reason: blockLabel,
    };

    if (!record) {
      toCreate.push({ ...desired, role: dbRole(user), last_sync_at: now });
      continue;
    }

    // Airtable → Postgres: apply the team's role decision.
    const role = text(record.fields.role).toLowerCase();
    if (role === "user" || role === "user_not_idv" || role === "admin" || role === "banned") {
      const next = { isAdmin: role === "admin", isBanned: role === "banned" };
      if (next.isAdmin !== user.isAdmin || next.isBanned !== user.isBanned) {
        await db.update(users).set(next).where(eq(users.id, user.id));
        // Lifting a ban starts from a clean slate: old logins don't come back.
        if (user.isBanned && !next.isBanned) await deleteAllSessionsForUser(user.id);
        console.log(`Users sync: ${user.slackId} role ${dbRole(user)} → ${role}`);
        await logAdminAction({
          actorId: null,
          action: "user.role_changed",
          targetType: "user",
          targetId: user.id,
          details: `${user.slackId}: ${dbRole(user)} -> ${role} (set in the Airtable Users table)`,
        });
      }
    }

    // user <-> user_not_idv follows verification automatically; admin/banned never touched.
    const changedRole: Record<string, unknown> = {};
    if (role === "user" || role === "user_not_idv") {
      const wanted = isIdVerified(user.yswsStatus) ? "user" : "user_not_idv";
      if (role !== wanted) changedRole.role = wanted;
    }

    // Postgres → Airtable: only fields that actually differ (and last_sync_at
    // only when something did), so an idle table costs zero writes.
    const changed: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(desired)) {
      if (text(record.fields[field]) !== value) changed[field] = value;
    }
    Object.assign(changed, changedRole);
    if (Object.keys(changed).length > 0) {
      toUpdate.push({ id: record.id, fields: { ...changed, last_sync_at: now } });
    }
  }

  if (toCreate.length > 0) {
    // Last-moment re-read: a row created since the read above (another run, or a person
    // adding one by hand) must not turn into a duplicate.
    const fresh = await listRecords(tableId);
    const known = new Set(fresh.flatMap((r) => [text(r.fields.id), text(r.fields.slack_id)]).filter(Boolean));
    const reallyNew = toCreate.filter((row) => !known.has(text(row.id)) && !known.has(text(row.slack_id)));
    if (reallyNew.length > 0) await createRecords(tableId, reallyNew);
  }
  if (toUpdate.length > 0) await updateRecords(tableId, toUpdate);
}

export async function runUsersSync() {
  return runExclusive("users-sync", syncUsers);
}

// Slower than the submissions sync on purpose: a role change taking up to ~30s
// is fine, and it keeps the combined Airtable request rate low.
export function scheduleUsersSync() {
  if (!config.airtable.usersTableId) return;

  setInterval(() => {
    if (airtableCoolingDown()) return;
    runUsersSync().catch((err) => {
      console.error("Users sync failed", err instanceof Error ? err.message : err);
    });
  }, config.airtable.usersSyncIntervalSeconds * 1000);
}
