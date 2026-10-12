// No longer run on a schedule — eligibility is checked live instead, at
// login (routes/auth.ts) and again at the two real "gates" that matter
// (submitting a project, buying from the shop — see lib/eligibility-check.ts).
// This function survives only as a manual admin action (POST
// /api/internal/sync/eligibility) for bulk-refreshing every user at once,
// e.g. after a known mass Hackatime ban.

import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { fetchHackatimeTrustLevel } from "../integrations/hackatime.js";
import { checkYswsEligibility } from "../integrations/hackclub-auth.js";

export async function syncEligibility() {
  const rows = await db.select({ id: users.id, slackId: users.slackId }).from(users);

  for (const row of rows) {
    const [trustLevel, yswsStatus] = await Promise.all([
      fetchHackatimeTrustLevel(row.slackId),
      checkYswsEligibility(row.slackId),
    ]);

    // A null from either call means that one API hiccuped this run — leave
    // that field alone rather than guessing, the next run will retry it.
    if (trustLevel === null && yswsStatus === null) {
      continue;
    }

    const updateSet: { hackatimeBanned?: boolean; yswsStatus?: NonNullable<typeof yswsStatus> } = {};
    if (trustLevel !== null) updateSet.hackatimeBanned = trustLevel === "red";
    if (yswsStatus !== null) updateSet.yswsStatus = yswsStatus;

    await db.update(users).set(updateSet).where(eq(users.id, row.id));
  }
}
