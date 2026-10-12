// The same Hackatime hours must not be paid twice. A person's other projects are
// compared by Hackatime project name: if one that is pending review or approved
// already uses a name, this project can't be submitted; overlaps with other
// projects (drafts) are only flagged to the reviewer in the submission history.

import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { projects } from "../db/schema.js";
import { namesFromFormatted } from "./hackatime-selection.js";

export type HoursOverlap = {
  hackatimeProject: string;
  projectName: string;
  status: string;
  // true for a project that is pending review ("submitted") or approved
  blocking: boolean;
};

// Takes an optional executor so the submit claim can re-run it inside its locked transaction.
export async function findHoursOverlaps(
  userId: string,
  projectId: string,
  hackatimeNames: string[],
  executor: Pick<typeof db, "select"> = db,
): Promise<HoursOverlap[]> {
  const wanted = new Map(hackatimeNames.map((name) => [name.toLowerCase(), name]));
  if (wanted.size === 0) return [];

  const others = await executor
    .select({ name: projects.name, status: projects.status, hackatime: projects.hackatimeProjectsAndDates })
    .from(projects)
    .where(and(eq(projects.userId, userId), ne(projects.id, projectId), isNotNull(projects.hackatimeProjectsAndDates)));

  const overlaps: HoursOverlap[] = [];
  for (const other of others) {
    for (const used of namesFromFormatted(other.hackatime)) {
      const mine = wanted.get(used.toLowerCase());
      if (!mine) continue;
      overlaps.push({
        hackatimeProject: mine,
        projectName: other.name,
        status: other.status,
        blocking: other.status === "submitted" || other.status === "approved",
      });
    }
  }
  return overlaps;
}
