// Live eligibility re-check for an already-logged-in user — called from the
// places that actually matter (submitting a project, buying from the shop,
// the /blocked page), not on a schedule. Replaces the old scheduled batch job
// entirely: checking once at login plus again at the real "gates" catches a
// ban/eligibility change exactly when it matters, without background polling.

import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { fetchHackatimeTrustLevel } from "../integrations/hackatime.js";
import { checkYswsEligibility } from "../integrations/hackclub-auth.js";
import { eligibilityBlockReason, isIdVerified, type BlockReason } from "./eligibility.js";
import type { SessionUser } from "./session.js";

type EligibilityUser = Pick<SessionUser, "id" | "slackId" | "hackatimeBanned" | "yswsStatus">;

async function resolveEligibility(user: EligibilityUser) {
  // Both swallow their own errors and return null on a hiccup. For page
  // gating that falls back to whatever is already stored rather than wrongly
  // banning someone over a transient outage; payout gates treat a still-
  // unknown status as unverified (see checkEligibilityForGate).
  const [trustLevel, yswsStatus] = await Promise.all([
    fetchHackatimeTrustLevel(user.slackId),
    checkYswsEligibility(user.slackId),
  ]);

  const hackatimeBanned = trustLevel !== null ? trustLevel === "red" : user.hackatimeBanned;
  const resolvedYswsStatus = yswsStatus ?? user.yswsStatus;

  if (trustLevel !== null || yswsStatus !== null) {
    await db
      .update(users)
      .set({
        ...(trustLevel !== null ? { hackatimeBanned } : {}),
        ...(yswsStatus !== null ? { yswsStatus } : {}),
      })
      .where(eq(users.id, user.id));
  }

  return {
    reason: eligibilityBlockReason(hackatimeBanned, resolvedYswsStatus),
    statusKnown: resolvedYswsStatus !== null,
    idVerified: isIdVerified(resolvedYswsStatus),
  };
}

// For the "I've verified, check again" button: refreshes the stored status and
// reports both whether they're hard-blocked and whether they're ID verified.
export async function recheckEligibility(user: EligibilityUser) {
  const { reason, idVerified } = await resolveEligibility(user);
  return { reason, idVerified };
}

export type GateVerdict =
  | { status: 403; body: { error: "not_eligible"; reason: BlockReason } }
  | { status: 403; body: { error: "not_verified" } }
  | { status: 503; body: { error: "eligibility_unverifiable" } };

// For routes that pay out or spend moles (submit, buy). Failing open is fine
// for page gating, not here: a hard block is refused, an unknown status asks
// the person to retry, and anyone who isn't ID verified is refused with
// "not_verified" (the UI shows the verify-in-Hack-Club-Auth message).
export async function checkEligibilityForGate(user: EligibilityUser): Promise<GateVerdict | null> {
  const { reason, statusKnown, idVerified } = await resolveEligibility(user);
  if (reason) return { status: 403, body: { error: "not_eligible", reason } };
  if (!statusKnown) return { status: 503, body: { error: "eligibility_unverifiable" } };
  if (!idVerified) return { status: 403, body: { error: "not_verified" } };
  return null;
}
