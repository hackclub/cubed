// Mirrors frontend/src/lib/eligibility-copy.ts's `eligibilityBlockReason`
// exactly (same priority order, same reason values) — frontend and backend
// are separate deployables with no shared code path, so this can't just be
// imported from one side; keep both in sync if this logic ever changes.
// Used at first-ever login (routes/auth.ts, deciding whether to create an
// account at all) and by lib/eligibility-check.ts's live re-check.
//
// Only HARD blocks live here. Not being ID-verified yet is deliberately NOT a
// block: those people get an account in read-only mode (they can explore and
// work on drafts but not submit, buy or upvote) — see isIdVerified below.

import type { YswsStatus } from "../integrations/hackclub-auth.js";

export type BlockReason = "hackatime_banned" | "rejected" | "over_18";

export function eligibilityBlockReason(hackatimeBanned: boolean, yswsStatus: YswsStatus | null): BlockReason | null {
  if (hackatimeBanned) return "hackatime_banned";
  if (yswsStatus === "rejected") return "rejected";
  if (yswsStatus === "verified_but_over_18") return "over_18";
  return null;
}

// The only status that unlocks submitting, buying and upvoting. Everything
// else (needs_submission, pending, not_found, or never checked) is "not
// verified": allowed in, but read-only.
export function isIdVerified(yswsStatus: YswsStatus | null): boolean {
  return yswsStatus === "verified_eligible";
}
