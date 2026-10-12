// Shared by middleware.ts and login-blocked.astro. one place for the reason-priority
// order and the copy, so the two flows can't drift apart.
import type { YswsStatus } from "./api";

// Hard blocks only. Not being ID verified yet is NOT one: those people get a
// read-only account (see lib/verification.ts), so it isn't a reason here.
export type BlockReason = "hackatime_banned" | "rejected" | "over_18";

export const BLOCK_REASONS: BlockReason[] = ["hackatime_banned", "rejected", "over_18"];

// Mirrors backend/src/lib/eligibility.ts's eligibilityBlockReason exactly.
export function eligibilityBlockReason(hackatimeBanned: boolean, yswsStatus: YswsStatus | null): BlockReason | null {
  if (hackatimeBanned) return "hackatime_banned";
  if (yswsStatus === "rejected") return "rejected";
  if (yswsStatus === "verified_but_over_18") return "over_18";
  return null;
}

export function getBlockCopy(reason: BlockReason): { heading: string; body: string; showAuthCta: boolean } {
  switch (reason) {
    case "hackatime_banned":
      return {
        heading: "You're Hackatime banned",
        body: "Your Hackatime account is currently banned, so you can't participate in Cubed. If you think this is a mistake, reach out on Slack.",
        showAuthCta: false,
      };
    case "rejected":
      return {
        heading: "You're not eligible for YSWS programs",
        body: "Hack Club Auth has marked you as not eligible for YSWS (You Ship, We Ship) programs, so you can't participate in Cubed.",
        showAuthCta: false,
      };
    case "over_18":
      return {
        heading: "You're a little too old for this one",
        body: "Cubed is a YSWS program for teens aged 13–18, and your verified age is over 18. You can't participate yourself, but you're welcome to tell friends aged 13–18 about it!",
        showAuthCta: false,
      };
  }
}
