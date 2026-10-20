// Admin DAU: Hackatime seconds per UTC day on each user's linked projects (every project
// except rejected ones). One request per user per run: their whole history (from program
// start) when the set of linked names changed or was never built, otherwise yesterday + today.

import { and, eq, gte, isNotNull, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { hackatimeActivity, projects, users } from "../db/schema.js";
import { config } from "../config.js";
import { fetchHackatimeSpans, type HackatimeSpan } from "../integrations/hackatime.js";
import { namesFromFormatted } from "../lib/hackatime-selection.js";
import { runExclusive } from "../lib/exclusive.js";

const RUN_EVERY_MS = 60 * 60_000;
const REQUEST_GAP_MS = 300;
const DAY_S = 86_400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const dayKey = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString().slice(0, 10);

function secondsPerDay(spans: HackatimeSpan[], from: number): Map<string, number> {
  const days = new Map<string, number>();
  for (const span of spans) {
    let start = Math.max(span.start, from);
    while (start < span.end) {
      const end = Math.min(span.end, (Math.floor(start / DAY_S) + 1) * DAY_S);
      days.set(dayKey(start), (days.get(dayKey(start)) ?? 0) + (end - start));
      start = end;
    }
  }
  return days;
}

type Linked = { slackId: string; stored: string | null; names: Set<string> };

async function loadLinkedUsers(): Promise<Map<string, Linked>> {
  const rows = await db
    .select({
      userId: projects.userId,
      slackId: users.slackId,
      stored: users.hackatimeActivityNames,
      hackatime: projects.hackatimeProjectsAndDates,
    })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.userId))
    .where(and(ne(projects.status, "rejected"), isNotNull(projects.hackatimeProjectsAndDates)));

  const linked = new Map<string, Linked>();
  for (const row of rows) {
    const entry = linked.get(row.userId) ?? { slackId: row.slackId, stored: row.stored, names: new Set<string>() };
    for (const name of namesFromFormatted(row.hackatime)) entry.names.add(name);
    linked.set(row.userId, entry);
  }
  return linked;
}

async function syncUser(userId: string, user: Linked, now: Date) {
  const names = [...user.names].sort();
  const signature = names.join("\n");
  const rebuild = user.stored !== signature;
  const from = rebuild
    ? new Date(`${config.programStartDate}T00:00:00Z`)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));

  const spans = await fetchHackatimeSpans(user.slackId, names, from, now);
  if (!spans) return;

  const fromSeconds = from.getTime() / 1000;
  const values = [...secondsPerDay(spans, fromSeconds)]
    .map(([day, seconds]) => ({ userId, day, seconds: Math.round(seconds) }))
    .filter((row) => row.seconds > 0);

  await db.transaction(async (tx) => {
    await tx
      .delete(hackatimeActivity)
      .where(rebuild ? eq(hackatimeActivity.userId, userId) : and(eq(hackatimeActivity.userId, userId), gte(hackatimeActivity.day, dayKey(fromSeconds))));
    if (values.length > 0) await tx.insert(hackatimeActivity).values(values);
    if (rebuild) await tx.update(users).set({ hackatimeActivityNames: signature }).where(eq(users.id, userId));
  });
}

export async function syncHackatimeActivity() {
  const linked = await loadLinkedUsers();

  // Nothing linked any more (projects deleted or rejected): their history no longer counts.
  const built = await db.select({ id: users.id }).from(users).where(isNotNull(users.hackatimeActivityNames));
  for (const { id } of built) {
    if (linked.has(id)) continue;
    await db.transaction(async (tx) => {
      await tx.delete(hackatimeActivity).where(eq(hackatimeActivity.userId, id));
      await tx.update(users).set({ hackatimeActivityNames: null }).where(eq(users.id, id));
    });
  }

  for (const [userId, user] of linked) {
    try {
      await syncUser(userId, user, new Date());
    } catch (err) {
      console.error("Hackatime activity sync failed for a user", err instanceof Error ? err.message : err);
    }
    await sleep(REQUEST_GAP_MS);
  }
}

export async function runHackatimeActivitySync() {
  return runExclusive("hackatime-activity", syncHackatimeActivity);
}

export function scheduleHackatimeActivitySync() {
  const run = () =>
    runHackatimeActivitySync().catch((err) => {
      console.error("Hackatime activity sync failed", err instanceof Error ? err.message : err);
    });
  run();
  setInterval(run, RUN_EVERY_MS);
}
