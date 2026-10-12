// Reads Airtable (writes live in routes/projects.ts and routes/shop.ts) —
// polls on a timer, or on demand via POST /api/internal/sync/airtable.
// syncSubmissions() is the only place moles get credited; syncShopItems()
// mirrors the shop catalog into Postgres.

import { and, count, eq, notInArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { projects, shopItems, submissions, transactions, users } from "../db/schema.js";
import { airtableCoolingDown, listRecords, listRecordsByIds } from "../integrations/airtable.js";
import { MAX_SUBMISSION_ATTEMPTS } from "../lib/limits.js";
import { logAdminAction } from "../lib/audit.js";
import { runExclusive } from "../lib/exclusive.js";
import { config } from "../config.js";

// Exact strings from the real Airtable "Status" single-select (case/spacing
// matters — a typo here means the sync job silently treats it as pending
// forever):
//   "pending review"              → not decided yet.
//   "approved (no fraud review)"  → treated as not-decided — a fast-track
//                                    status the reviewer later flips to
//                                    plain "Approved" to actually credit moles.
//   "Approved"                    → the only status that credits moles.
//   "need changes"                → "fix this and try again": closes this
//                                    attempt and reopens the project as an
//                                    editable draft (see syncOneSubmission).
//                                    Reviewers still DM tiny fixes on Slack and
//                                    leave the status alone.
//   "rejected"                    → final, no retry.
// Unset/blank comes through as `undefined`, treated the same as "pending review".
// ANY OTHER value (a new option such as "2nd pass", or a typo) is also left pending and
// logged once: only the exact word "rejected" ever rejects a project.
type ReviewStatus =
  | "pending review"
  | "approved (no fraud review)"
  | "Approved"
  | "need changes"
  | "rejected";

type SubmissionFields = {
  // Typed loosely on purpose: the single-select can gain options we don't know about.
  Status?: ReviewStatus | (string & {});
  // Reviewer-only — never written by our own submission form. Moles are
  // normally calculated from this.
  "Optional - Override Hours Spent"?: number;
  // Escape hatch — when set, overrides the hours×5 calculation entirely.
  "Optional - Override Approved Moles"?: number;
  // User-facing feedback — distinct from Airtable's own reviewer-only
  // "Internal Review Notes" (never read here).
  "review_reason(userfacing)"?: string;
};

// Everything syncOneSubmission reads, and nothing else (keep in step with SubmissionFields).
const SUBMISSION_SYNC_FIELDS = [
  "Status",
  "Optional - Override Hours Spent",
  "Optional - Override Approved Moles",
  "review_reason(userfacing)",
];

const APPROVED_STATUSES: string[] = ["Approved"];

const NOT_YET_DECIDED_STATUSES: string[] = ["pending review", "approved (no fraud review)"];

// Each unrecognised status is logged once per record, not every tick.
const warnedUnknownStatus = new Set<string>();

const MISSING_REOPEN_AFTER_MS = 24 * 60 * 60 * 1000;

// Record ids we already warned about, so a deleted Airtable record logs once
// instead of every sync run.
const warnedMissing = new Set<string>();

async function syncSubmissions() {
  // Only re-checks "pending" submissions — once decided, never re-checked.
  const pending = await db.select().from(submissions).where(eq(submissions.status, "pending"));
  if (pending.length === 0) return;

  // ONE request per 50 submissions instead of one each — the cost of a sync
  // run no longer grows with the backlog, which is what keeps it under
  // Airtable's rate limit.
  const records = await listRecordsByIds(
    config.airtable.submissionsTableId,
    pending.map((s) => s.airtableRecordId),
    SUBMISSION_SYNC_FIELDS,
  );
  const byId = new Map(records.map((r) => [r.id, r]));

  for (const submission of pending) {
    const record = byId.get(submission.airtableRecordId);
    if (!record) {
      if (!warnedMissing.has(submission.airtableRecordId)) {
        warnedMissing.add(submission.airtableRecordId);
        console.error(`Airtable record ${submission.airtableRecordId} (submission ${submission.id}) not found`);
      }
      try {
        await handleMissingRecord(submission, records.length > 0);
      } catch (err) {
        console.error(`Missing-record handling failed for submission ${submission.id}`, err instanceof Error ? err.message : err);
      }
      continue;
    }
    if (submission.airtableMissingSince) {
      await db.update(submissions).set({ airtableMissingSince: null }).where(eq(submissions.id, submission.id));
    }

    // Per-record, so one bad record can't stall every later submission.
    try {
      await syncOneSubmission(submission, record.fields as SubmissionFields);
    } catch (err) {
      console.error(
        `Airtable sync failed for submission ${submission.id}`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

// A pending submission whose Airtable record can't be found. Reopen it only after a full day
// of absence AND while other records in the same read WERE found (so a wrong base or an Airtable
// outage can never reopen everyone). The attempt counts, and the person is told to contact the team.
async function handleMissingRecord(submission: typeof submissions.$inferSelect, otherRecordsFound: boolean) {
  const now = new Date();
  if (!submission.airtableMissingSince) {
    await db.update(submissions).set({ airtableMissingSince: now }).where(eq(submissions.id, submission.id));
    return;
  }
  if (!otherRecordsFound || now.getTime() - submission.airtableMissingSince.getTime() < MISSING_REOPEN_AFTER_MS) return;

  await db.transaction(async (tx) => {
    const closed = await tx
      .update(submissions)
      .set({
        status: "changes_requested",
        feedback: "We couldn't find your submission on the review side, so it was reopened. Please check it and submit again, or message the Cubed team on Slack.",
        syncedAt: now,
      })
      .where(and(eq(submissions.id, submission.id), eq(submissions.status, "pending")))
      .returning({ id: submissions.id });
    if (closed.length === 0) return;
    await tx
      .update(projects)
      .set({ status: "draft", updatedAt: now })
      .where(and(eq(projects.id, submission.projectId), eq(projects.status, "submitted")));
  });
  await logAdminAction({
    actorId: null,
    action: "submission.record_missing",
    targetType: "submission",
    targetId: submission.id,
    details: `Airtable record ${submission.airtableRecordId} was missing for over a day; the project was reopened as a draft`,
  });
}

async function syncOneSubmission(submission: typeof submissions.$inferSelect, fields: SubmissionFields) {
  if (!fields.Status || NOT_YET_DECIDED_STATUSES.includes(fields.Status)) {
    return;
  }

  if (fields.Status === "need changes") {
    await db.transaction(async (tx) => {
      const [{ attempts }] = await tx
        .select({ attempts: count() })
        .from(submissions)
        .where(eq(submissions.projectId, submission.projectId));

      // Out of attempts: asking for yet another round would only dead-end the
      // person on a draft they can't submit, so it becomes a final rejection
      // (the reviewer's note is kept as the reason).
      const outOfAttempts = attempts >= MAX_SUBMISSION_ATTEMPTS;

      await tx
        .update(submissions)
        .set({
          status: outOfAttempts ? "rejected" : "changes_requested",
          feedback: fields["review_reason(userfacing)"] ?? null,
          syncedAt: new Date(),
        })
        .where(eq(submissions.id, submission.id));

      // Only reopens a project that is still "submitted" — never one that
      // moved on some other way in the meantime.
      await tx
        .update(projects)
        .set({ status: outOfAttempts ? "rejected" : "draft", updatedAt: new Date() })
        .where(and(eq(projects.id, submission.projectId), eq(projects.status, "submitted")));
    });
    return;
  }

  if (APPROVED_STATUSES.includes(fields.Status)) {
    // The ONE place moles get credited — must stay atomic (ledger +
    // balance together) and idempotent (a repeated sync must not double-credit).
    const hours = fields["Optional - Override Hours Spent"];
    const molesOverride = fields["Optional - Override Approved Moles"];

    // Airtable omits blank number fields, so an "Approved" with no hours and
    // no override used to credit 0 moles and be marked accepted forever.
    // Leave it pending until the reviewer fills one in; negatives are
    // treated the same way (never a deduction).
    if ((hours != null && hours < 0) || (molesOverride != null && molesOverride < 0)) return;
    if (molesOverride == null && !(hours != null && hours > 0)) return;

    const approvedHours = hours ?? 0;
    // floor(hours×5), unless molesOverride is set — then that wins outright.
    const moles = molesOverride != null ? Math.floor(molesOverride) : Math.floor(approvedHours * 5);
    // Stable per-project receipt string — this is what makes crediting idempotent below.
    const reason = `project:${submission.projectId} approved`;

    await db.transaction(async (tx) => {
      await tx
        .update(submissions)
        .set({
          status: "accepted",
          approvedHours: String(approvedHours),
          feedback: fields["review_reason(userfacing)"] ?? null,
          syncedAt: new Date(),
        })
        .where(eq(submissions.id, submission.id));

      // Mirrored onto projects.status so the dashboard doesn't need to join submissions.
      await tx
        .update(projects)
        .set({ status: "approved", updatedAt: new Date() })
        .where(eq(projects.id, submission.projectId));

      // Guards against a repeated/overlapping sync run crediting the same approval twice.
      const [alreadyCredited] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.reason, reason));

      if (alreadyCredited) {
        // Status updates above still commit; only the crediting is skipped.
        return;
      }

      const [project] = await tx
        .select({ userId: projects.userId })
        .from(projects)
        .where(eq(projects.id, submission.projectId));

      // Ledger insert + balance bump in the same transaction —
      // transactions is append-only and must always explain a balance change.
      await tx.insert(transactions).values({
        userId: project.userId,
        type: "earned",
        amount: moles,
        reason,
        refId: submission.projectId,
      });

      await tx
        .update(users)
        .set({ molesBalance: sql`${users.molesBalance} + ${moles}` })
        .where(eq(users.id, project.userId));
    });
  } else if (fields.Status === "rejected") {
    // Terminal, no moles. ONLY this exact status rejects a project.
    await db.transaction(async (tx) => {
      await tx
        .update(submissions)
        .set({
          status: "rejected",
          feedback: fields["review_reason(userfacing)"] ?? null,
          syncedAt: new Date(),
        })
        .where(eq(submissions.id, submission.id));

      await tx
        .update(projects)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(eq(projects.id, submission.projectId));
    });
  } else {
    // A status this code doesn't know (a new option such as "2nd pass", or a typo): stay pending.
    const key = `${submission.airtableRecordId}:${fields.Status}`;
    if (!warnedUnknownStatus.has(key)) {
      warnedUnknownStatus.add(key);
      console.warn(`Airtable record ${submission.airtableRecordId} has the unrecognised Status "${fields.Status}"; leaving it pending`);
    }
  }
}

// Field names match the real "shop_items" table:
//  - image_url is a plain URL, not an Airtable attachment — items are
//    expected to be hosted elsewhere (e.g. a CDN).
//  - "catagory" (sic) is the real field's actual spelling.
//  - cost_moles is treated as the true price (maps to price_moles); the
//    table also has an unused cost_hours — unconfirmed which is meant to
//    be canonical.
//  - active is a checkbox, and Airtable's API omits the key entirely when
//    it's unticked (never sends false) — so a missing key means inactive.
type ShopItemFields = {
  item_name?: string;
  description?: string;
  image_url?: string;
  catagory?: string;
  cost_moles?: number;
  active?: boolean;
};

async function syncShopItems() {
  const tableId = config.airtable.shopItemsTableId;
  // Full read every run — no "pending" concept for shop items, just upsert everything.
  const records = await listRecords(tableId);

  for (const record of records) {
    const fields = record.fields as ShopItemFields;

    // Airtable omits a blank cost_moles, which used to become a price of 0
    // (a free item) — and a negative price would ADD moles on purchase. Items
    // without a valid positive price are kept inactive instead.
    const priceMoles = Math.floor(fields.cost_moles ?? 0);
    const hasValidPrice = Number.isFinite(priceMoles) && priceMoles > 0;
    const active = fields.active === true && hasValidPrice && !!fields.item_name?.trim();

    // airtable_record_id ties a Postgres row to its Airtable row permanently.
    await db
      .insert(shopItems)
      .values({
        airtableRecordId: record.id,
        name: fields.item_name ?? "",
        description: fields.description ?? null,
        imageUrl: fields.image_url ?? null,
        category: fields.catagory ?? null,
        priceMoles: hasValidPrice ? priceMoles : 0,
        active,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: shopItems.airtableRecordId,
        set: {
          name: fields.item_name ?? "",
          description: fields.description ?? null,
          imageUrl: fields.image_url ?? null,
          category: fields.catagory ?? null,
          priceMoles: hasValidPrice ? priceMoles : 0,
          active,
          syncedAt: new Date(),
        },
      });
  }

  // A row deleted in Airtable must stop being buyable. Deactivated rather
  // than deleted from Postgres because past orders reference the item. Safe
  // against partial reads: listRecords follows pagination to the end or throws.
  const liveIds = records.map((record) => record.id);
  // An empty read (wrong base or view, a glitch) would switch off the whole shop; the next good
  // read would switch it back on, but buyers would be turned away meanwhile. Keep what we have.
  if (liveIds.length === 0) {
    console.warn("Shop sync: Airtable returned no items, leaving the catalog as it is");
    return;
  }
  await db
    .update(shopItems)
    .set({ active: false, syncedAt: new Date() })
    .where(
      and(eq(shopItems.active, true), notInArray(shopItems.airtableRecordId, liveIds)),
    );
}

// Exported so admin.ts's manual sync button can call it too.
// Each half runs even if the other fails, so e.g. a broken submission read
// can't freeze the shop catalog.
export async function syncFromAirtable() {
  const failures: unknown[] = [];
  for (const step of [syncSubmissions, syncShopItems]) {
    try {
      await step();
    } catch (err) {
      failures.push(err);
    }
  }
  if (failures.length > 0) throw failures[0];
}

// The timer and the admin's "sync now" button share one guard, so they never overlap.
export async function runAirtableSync() {
  return runExclusive("airtable-sync", syncFromAirtable);
}

// Interval is configurable via AIRTABLE_SYNC_INTERVAL_SECONDS (default 10, see config.ts).
export function scheduleAirtableSync() {
  setInterval(() => {
    // At a short interval a slow run (many pending submissions, Airtable
    // latency) can outlast the interval — skip instead of stacking runs.
    // Also skipped during the post-429 cooldown (integrations/airtable.ts).
    if (airtableCoolingDown()) return;
    // Swallowed so a transient Airtable outage doesn't crash the process.
    runAirtableSync().catch((err) => {
      console.error("Airtable sync failed", err instanceof Error ? err.message : err);
    });
  }, config.airtable.syncIntervalSeconds * 1000);
}
