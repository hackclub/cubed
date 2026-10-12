// Housekeeping that repairs half-finished work, once a minute:
//  - a project left "submitted" with no pending submission (the server died between claiming
//    the project and recording the Airtable submission) goes back to being an editable draft,
//  - Airtable records that couldn't be deleted earlier (rate-limit pause) are deleted,
//  - shop orders left "pending" are matched to their fulfillment record or refunded.

import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { projects } from "../db/schema.js";
import { logAdminAction } from "../lib/audit.js";
import { processAirtableCleanup, queueSubmissionSweep } from "../lib/airtable-cleanup.js";
import { reconcilePendingOrders } from "../lib/orders.js";

const STUCK_AFTER_MS = 10 * 60 * 1000;

export async function recoverStuckSubmissions(): Promise<void> {
  const recovered = await db
    .update(projects)
    .set({ status: "draft", updatedAt: new Date() })
    .where(
      and(
        eq(projects.status, "submitted"),
        lt(projects.updatedAt, new Date(Date.now() - STUCK_AFTER_MS)),
        sql`not exists (select 1 from submissions where submissions.project_id = projects.id and submissions.status = 'pending')`,
      ),
    )
    .returning({ id: projects.id, name: projects.name });

  for (const project of recovered) {
    // The server may have died after Airtable created the record but before we saved its id.
    await queueSubmissionSweep(project.id);
    await logAdminAction({
      actorId: null,
      action: "project.submit_recovered",
      targetType: "project",
      targetId: project.id,
      details: `${project.name}: stuck as submitted with no submission record, reopened as a draft`,
    });
  }
}

export async function runMaintenance(): Promise<void> {
  for (const step of [recoverStuckSubmissions, processAirtableCleanup, reconcilePendingOrders]) {
    try {
      await step();
    } catch (err) {
      console.error(`Maintenance step ${step.name} failed`, err instanceof Error ? err.message : err);
    }
  }
}

let running = false;

export function scheduleMaintenance() {
  setInterval(() => {
    if (running) return;
    running = true;
    runMaintenance().finally(() => {
      running = false;
    });
  }, 60 * 1000);
}
