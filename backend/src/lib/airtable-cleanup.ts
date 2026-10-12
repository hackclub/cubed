// Airtable records that must be deleted but couldn't be right now (typically during the
// 30-second pause after a rate limit). Only the table and record ids are stored, never
// the record's contents; the maintenance job retries until Airtable lets it through.

import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { airtableCleanup } from "../db/schema.js";
import { airtableCoolingDown, AirtableRateLimitError, deleteRecord, findRecordsByFormula } from "../integrations/airtable.js";
import { submissions } from "../db/schema.js";
import { config } from "../config.js";

const MAX_ATTEMPTS = 30;

// A sweep for a project's submission records that Airtable may have created without us ever
// learning their ids (a timeout, or a crash before the id was saved). Only records at least this
// old, with this project's marker, and not linked to any submission row are deleted.
const SWEEP_MIN_AGE_MS = 2 * 60 * 1000;
const SWEEP_MAX_ATTEMPTS = 10;
const SWEEP_PREFIX = "sweep:";
export const submissionMarker = (projectId: string) => `Cubed ref: ${projectId}`;

// Never throws: it runs inside an error handler that must still finish its own work.
export async function queueAirtableDelete(tableId: string, recordId: string): Promise<void> {
  try {
    await db.insert(airtableCleanup).values({ tableId, recordId }).onConflictDoNothing();
  } catch (err) {
    console.error(`Could not queue Airtable record ${recordId} for deletion`, err instanceof Error ? err.message : err);
  }
}

// Delete now; if that fails, queue it. The queue row is written FIRST, so a crash between the two
// can't lose the record, and removed again once the delete succeeded.
export async function deleteOrQueue(tableId: string, recordId: string): Promise<void> {
  await queueAirtableDelete(tableId, recordId);
  try {
    await deleteRecord(tableId, recordId);
    await db.delete(airtableCleanup).where(eq(airtableCleanup.recordId, recordId));
  } catch (err) {
    console.error(`Could not delete Airtable record ${recordId} yet, left queued`, err instanceof Error ? err.message : err);
  }
}

export async function queueSubmissionSweep(projectId: string): Promise<void> {
  await queueAirtableDelete(config.airtable.submissionsTableId, `${SWEEP_PREFIX}${projectId}`);
}

async function runSweep(item: typeof airtableCleanup.$inferSelect): Promise<"done" | "retry"> {
  const projectId = item.recordId.slice(SWEEP_PREFIX.length);
  const found = await findRecordsByFormula(item.tableId, `FIND('${submissionMarker(projectId)}', {Submission History}) > 0`);
  const known = new Set((await db.select({ id: submissions.airtableRecordId }).from(submissions)).map((row) => row.id));
  const orphans = found.filter(
    (record) => !known.has(record.id) && Date.now() - new Date(record.createdTime).getTime() >= SWEEP_MIN_AGE_MS,
  );
  for (const orphan of orphans) await deleteRecord(item.tableId, orphan.id);
  // Nothing to delete yet: the write might still be landing, so look again for a few minutes.
  return orphans.length > 0 || item.attempts + 1 >= SWEEP_MAX_ATTEMPTS ? "done" : "retry";
}

export async function processAirtableCleanup(): Promise<void> {
  if (airtableCoolingDown()) return;

  const queued = await db.select().from(airtableCleanup).orderBy(asc(airtableCleanup.createdAt)).limit(10);
  for (const item of queued) {
    try {
      if (item.recordId.startsWith(SWEEP_PREFIX)) {
        if ((await runSweep(item)) === "retry") {
          await db.update(airtableCleanup).set({ attempts: sql`${airtableCleanup.attempts} + 1` }).where(eq(airtableCleanup.id, item.id));
          continue;
        }
      } else {
        await deleteRecord(item.tableId, item.recordId);
      }
      await db.delete(airtableCleanup).where(eq(airtableCleanup.id, item.id));
    } catch (err) {
      // A rate-limit pause: stop now, the next run tries again.
      if (err instanceof AirtableRateLimitError) return;
      const message = err instanceof Error ? err.message : String(err);
      // Already gone counts as done; anything else is retried a limited number of times.
      if (message.includes(" 404 ") || item.attempts + 1 >= MAX_ATTEMPTS) {
        if (!message.includes(" 404 ")) console.error(`Giving up deleting Airtable record ${item.recordId}: ${message}`);
        await db.delete(airtableCleanup).where(eq(airtableCleanup.id, item.id));
      } else {
        await db
          .update(airtableCleanup)
          .set({ attempts: sql`${airtableCleanup.attempts} + 1` })
          .where(eq(airtableCleanup.id, item.id));
      }
    }
  }
}
