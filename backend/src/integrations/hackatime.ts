// Hackatime's public trust-factor lookup — no auth required, keyed by
// Slack ID. Only "red" (convicted) blocks participation; "blue" (unscored)
// and "green" (trusted) both pass. The internal "yellow" (suspected) level
// is masked to "blue" by Hackatime itself before it ever reaches us.

export type HackatimeTrustLevel = "blue" | "red" | "green";

const VALID_LEVELS: HackatimeTrustLevel[] = ["blue", "red", "green"];

export async function fetchHackatimeTrustLevel(slackId: string): Promise<HackatimeTrustLevel | null> {
  try {
    const url = `https://hackatime.hackclub.com/api/v1/users/${encodeURIComponent(slackId)}/trust_factor`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { trust_level?: string };
    return VALID_LEVELS.includes(data.trust_level as HackatimeTrustLevel) ? (data.trust_level as HackatimeTrustLevel) : null;
  } catch {
    // An unreachable Hackatime should never fail a login or a sync run outright.
    return null;
  }
}

export type HackatimeProject = { name: string; hours: number; minutes: number; text: string; totalSeconds: number };

// Same public, unauthenticated `/stats` endpoint Hackatime itself uses for
// its own dashboard — undocumented in the newer Swagger docs at
// /api-docs, but verified live: date filtering genuinely narrows
// `projects`/`total_seconds` (despite the response's `range` field always
// saying "all_time" regardless — that label appears to just be cosmetic).
// A bad/unknown slackId 404s with {"error": "User not found"}, handled the
// same as any other failure here — null, not a thrown error.
export async function fetchHackatimeProjects(
  slackId: string,
  startDate: string,
  endDate: string,
): Promise<{ hackatimeUserId: string; projects: HackatimeProject[] } | null> {
  try {
    const url = new URL(`https://hackatime.hackclub.com/api/v1/users/${encodeURIComponent(slackId)}/stats`);
    url.searchParams.set("features", "projects");
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as {
      data?: {
        user_id?: string;
        projects?: { name: string; hours: number; minutes: number; text: string; total_seconds?: number }[];
      };
    };
    if (!body.data) {
      return null;
    }

    return {
      hackatimeUserId: body.data.user_id ?? "",
      projects: (body.data.projects ?? []).map((p) => ({
        name: p.name,
        hours: p.hours,
        minutes: p.minutes,
        text: p.text,
        // Fall back to the rounded h/m if a future API version drops total_seconds.
        totalSeconds: Math.max(0, Math.round(p.total_seconds ?? p.hours * 3600 + p.minutes * 60)),
      })),
    };
  } catch {
    return null;
  }
}
