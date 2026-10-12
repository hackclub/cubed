// Hack Club Auth's public `/api/external/check` endpoint — no OAuth token
// needed (unlike routes/auth.ts's login flow), keyed by Slack ID instead.
// This is the one place that distinguishes "rejected" from "verified but
// over 18" from "hasn't finished verifying yet" — the login flow's
// `ysws_eligible` boolean (from /api/v1/me) can't tell those apart.

export type YswsStatus =
  | "needs_submission"
  | "pending"
  | "verified_eligible"
  | "verified_but_over_18"
  | "rejected"
  | "not_found";

const VALID_STATUSES: YswsStatus[] = [
  "needs_submission",
  "pending",
  "verified_eligible",
  "verified_but_over_18",
  "rejected",
  "not_found",
];

export async function checkYswsEligibility(slackId: string): Promise<YswsStatus | null> {
  try {
    const url = new URL("https://auth.hackclub.com/api/external/check");
    url.searchParams.set("slack_id", slackId);

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { result?: string };
    return VALID_STATUSES.includes(data.result as YswsStatus) ? (data.result as YswsStatus) : null;
  } catch {
    // An unreachable Hack Club Auth should never fail a login or a sync run outright.
    return null;
  }
}
