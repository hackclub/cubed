// Append-only record of who did what in the admin area, plus automatic actions that
// change someone's access or money (shown to admins at /admin/audit). Never throws:
// a failure to write the audit row must not undo or block the action itself.

import { db } from "../db/client.js";
import { adminActions } from "../db/schema.js";

export type AuditEntry = {
  // null = the system itself (e.g. a role change made in Airtable, a recovery job)
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: string;
};

export async function logAdminAction(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(adminActions).values({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      details: entry.details ? entry.details.slice(0, 500) : null,
    });
  } catch (err) {
    console.error("Audit log write failed", err instanceof Error ? err.message : err);
  }
}
