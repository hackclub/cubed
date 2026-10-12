// Plain-text summary written to Airtable's "Submission History" field on every
// submission, so a reviewer sees which attempt this is and what happened
// before — on this project, and on the same person's other projects (that is
// how a rejected idea coming back, or hours already approved elsewhere, gets
// noticed). A snapshot taken at submit time. Only the reviewer's USER-FACING
// notes are used; Airtable's internal review notes are never read.

import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { projects, submissions } from "../db/schema.js";
import { MAX_SUBMISSION_ATTEMPTS } from "./limits.js";
import type { HoursOverlap } from "./hours-overlap.js";

const OTHER_PROJECTS_SHOWN = 5;
const NOTE_MAX = 200;
const TEXT_MAX = 4000;

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending review",
  accepted: "Approved",
  rejected: "Rejected",
  changes_requested: "Changes requested",
};

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function note(feedback: string | null): string {
  if (!feedback?.trim()) return "";
  const clean = feedback.trim().replace(/\s+/g, " ");
  return ` — "${clean.length > NOTE_MAX ? `${clean.slice(0, NOTE_MAX)}…` : clean}"`;
}

export async function buildSubmissionHistory(userId: string, projectId: string, overlaps: HoursOverlap[] = []) {
  const own = await db
    .select({
      status: submissions.status,
      feedback: submissions.feedback,
      approvedHours: submissions.approvedHours,
      submittedAt: submissions.submittedAt,
    })
    .from(submissions)
    .where(eq(submissions.projectId, projectId))
    .orderBy(asc(submissions.submittedAt));

  const otherRows = await db
    .select({
      projectId: projects.id,
      name: projects.name,
      status: submissions.status,
      feedback: submissions.feedback,
      approvedHours: submissions.approvedHours,
      submittedAt: submissions.submittedAt,
    })
    .from(submissions)
    .innerJoin(projects, eq(submissions.projectId, projects.id))
    .where(and(eq(projects.userId, userId), ne(projects.id, projectId)))
    .orderBy(desc(submissions.submittedAt))
    .limit(OTHER_PROJECTS_SHOWN * 10);

  // One line per PROJECT (its most recent attempt), not one per attempt — a
  // project with three attempts must not use up three of the slots.
  const seenProjects = new Set<string>();
  const others = otherRows
    .filter((row) => !seenProjects.has(row.projectId) && seenProjects.add(row.projectId))
    .slice(0, OTHER_PROJECTS_SHOWN);

  const attemptNumber = own.length + 1;
  const lines: string[] = [`Attempt ${attemptNumber} of ${MAX_SUBMISSION_ATTEMPTS}`];

  if (own.length > 0) {
    lines.push("", "Earlier attempts on this project:");
    own.forEach((s, i) => {
      lines.push(`${i + 1}. ${day(s.submittedAt)} — ${STATUS_LABEL[s.status] ?? s.status}${note(s.feedback)}`);
    });
  }

  lines.push("", "Other projects by this person:");
  if (others.length === 0) {
    lines.push("None submitted yet.");
  } else {
    for (const s of others) {
      const hours = s.status === "accepted" && s.approvedHours ? `, ${Number(s.approvedHours)} hours` : "";
      lines.push(`- ${s.name} — ${STATUS_LABEL[s.status] ?? s.status} (${day(s.submittedAt)}${hours})${note(s.feedback)}`);
    }
  }

  if (overlaps.length > 0) {
    lines.push("", "Hackatime hours also used on this person's other projects:");
    for (const overlap of overlaps) {
      lines.push(`- Hackatime project "${overlap.hackatimeProject}" also used on project "${overlap.projectName}" (${overlap.status})`);
    }
  }

  const text = lines.join("\n");
  return { attemptNumber, text: text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text };
}
