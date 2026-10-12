// A rejected project is final, so the same person can't start a fresh project
// on the same work and submit it again: its Hackatime projects and its repo
// link are off limits to their other projects. Retries after "need changes"
// are unaffected — those stay on the SAME project (excluded below).

import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { projects } from "../db/schema.js";
import { namesFromFormatted } from "./hackatime-selection.js";

// Same repo however it was typed: scheme, "www.", case, trailing slash and ".git" ignored.
export function normalizeRepoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    const path = parsed.pathname.replace(/\/+$/, "").replace(/\.git$/i, "");
    return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${path.toLowerCase()}`;
  } catch {
    return null;
  }
}

export type ReuseConflict = { kind: "hackatime" | "repo"; value: string };

export async function findRejectedReuse(
  userId: string,
  excludeProjectId: string | null,
  candidate: { hackatimeNames?: string[]; repoUrl?: string | null },
): Promise<ReuseConflict | null> {
  const rejected = await db
    .select({ repoUrl: projects.repoUrl, hackatime: projects.hackatimeProjectsAndDates })
    .from(projects)
    .where(
      and(
        eq(projects.userId, userId),
        eq(projects.status, "rejected"),
        ...(excludeProjectId ? [ne(projects.id, excludeProjectId)] : []),
      ),
    );

  const repo = normalizeRepoUrl(candidate.repoUrl);
  const names = new Set((candidate.hackatimeNames ?? []).map((n) => n.toLowerCase()));

  for (const row of rejected) {
    if (repo && normalizeRepoUrl(row.repoUrl) === repo) {
      return { kind: "repo", value: candidate.repoUrl! };
    }
    for (const name of namesFromFormatted(row.hackatime)) {
      if (names.has(name.toLowerCase())) return { kind: "hackatime", value: name };
    }
  }
  return null;
}
