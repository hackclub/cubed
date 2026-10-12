// The Hackatime project selection on a draft ends up in Airtable's
// "Justification - ..." fields, which reviewers trust. So the client only ever
// names projects: the date range is fixed (program start → today, never
// user-chosen), the Hackatime user ID is resolved here, and every name is
// checked against the caller's OWN Hackatime account (looked up by their
// session's Slack ID) — otherwise anyone could PATCH in someone else's ID,
// invented dates, or projects they never worked on.

import { config } from "../config.js";
import { fetchHackatimeProjects } from "../integrations/hackatime.js";

export const MAX_HACKATIME_PROJECTS = 20;

// "name M/D/YYYY-M/D/YYYY", comma-joined — the format Airtable's field expects.
// Names may contain spaces or commas, so entries are matched by their trailing
// date range rather than split naively.
const ENTRY_REGEX = /(.+?) \d{1,2}\/\d{1,2}\/\d{4}-\d{1,2}\/\d{1,2}\/\d{4}(?:, |$)/gy;

function isoToUs(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

// Always the whole program window (config.programStartDate to programEndDate), the same
// for everyone and whatever day they submit. Hackatime simply has no hours after today.
export function trackingRange() {
  const start = config.programStartDate;
  const end = config.programEndDate;
  return { start, end, startUs: isoToUs(start), endUs: isoToUs(end) };
}

// Pulls the project names back out of a stored "name range, name range" string.
export function namesFromFormatted(formatted: string | null | undefined): string[] {
  if (!formatted) return [];
  const names: string[] = [];
  ENTRY_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENTRY_REGEX.exec(formatted)) !== null) {
    names.push(match[1]);
  }
  return names;
}

export type SelectionResult =
  | { ok: true; formatted: string; hackatimeUserId: string; totalSeconds: number }
  | { ok: false; error: "invalid_hackatime_selection" | "hackatime_project_not_found" | "hackatime_unavailable" };

export async function verifyHackatimeProjects(slackId: string, rawNames: string[]): Promise<SelectionResult> {
  const names = [...new Set(rawNames.map((n) => n.trim()).filter(Boolean))];
  if (names.length === 0 || names.length > MAX_HACKATIME_PROJECTS) {
    return { ok: false, error: "invalid_hackatime_selection" };
  }

  const range = trackingRange();
  const stats = await fetchHackatimeProjects(slackId, range.start, range.end);
  if (!stats || !stats.hackatimeUserId) return { ok: false, error: "hackatime_unavailable" };

  const available = new Set(stats.projects.map((p) => p.name));
  if (!names.every((name) => available.has(name))) return { ok: false, error: "hackatime_project_not_found" };

  return {
    ok: true,
    formatted: names.map((name) => `${name} ${range.startUs}-${range.endUs}`).join(", "),
    hackatimeUserId: stats.hackatimeUserId,
    totalSeconds: stats.projects.filter((p) => names.includes(p.name)).reduce((sum, p) => sum + p.totalSeconds, 0),
  };
}
