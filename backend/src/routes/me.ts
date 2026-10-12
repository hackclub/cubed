import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { projects, transactions, users } from "../db/schema.js";
import { requireAuth, type SessionContext } from "../lib/session.js";
import { fetchHackatimeProjects } from "../integrations/hackatime.js";
import { trackingRange } from "../lib/hackatime-selection.js";
import { recheckEligibility } from "../lib/eligibility-check.js";
import { text } from "../lib/text.js";

// Letters/numbers/underscores only — safe to show unescaped anywhere
// (gallery cards, HUD, admin) without lookalike-character or whitespace tricks.
const NICKNAME_REGEX = /^[A-Za-z0-9_]+$/;
const nicknameField = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(NICKNAME_REGEX, "Nicknames can only contain letters, numbers, and underscores");

const nicknameSchema = z.object({
  nickname: nicknameField,
});

const onboardingSchema = z.object({
  nickname: nicknameField,
  heardAboutSource: z.enum([
    "friends_family",
    "instagram_youtube",
    "hackclub_site",
    "slack",
    "email",
    "school",
    "other",
  ]),
  heardAboutDetail: text(0, 1000, true).optional(),
});

export const meRoutes = new Hono<SessionContext>();

meRoutes.get("/", requireAuth, (c) => {
  return c.json(c.get("user"));
});

// Called by /blocked so a user who got unbanned/verified can get back in
// without anyone touching the database — runs the same live check (and
// persists the fresh result) as submit/buy.
meRoutes.post("/recheck-eligibility", requireAuth, async (c) => {
  const { reason, idVerified } = await recheckEligibility(c.get("user")!);
  return c.json({ reason, idVerified });
});

meRoutes.patch("/", requireAuth, bodyLimit({ maxSize: 100 * 1024 }), zValidator("json", nicknameSchema), async (c) => {
  const user = c.get("user")!;
  const input = c.req.valid("json");

  const [row] = await db
    .update(users)
    .set({ nickname: input.nickname })
    .where(eq(users.id, user.id))
    .returning({ id: users.id, nickname: users.nickname });

  return c.json(row);
});

// Replayable — ProfilePopup.svelte links back to /onboarding to revisit
// it. onboardedAt is only ever set once; a replay doesn't bump it.
meRoutes.post("/onboarding", requireAuth, bodyLimit({ maxSize: 100 * 1024 }), zValidator("json", onboardingSchema), async (c) => {
  const user = c.get("user")!;
  const input = c.req.valid("json");

  const [row] = await db
    .update(users)
    .set({
      nickname: input.nickname,
      heardAboutSource: input.heardAboutSource,
      heardAboutDetail: input.heardAboutDetail,
      onboardedAt: user.onboardedAt ?? new Date(),
    })
    .where(eq(users.id, user.id))
    .returning({ id: users.id, nickname: users.nickname, onboardedAt: users.onboardedAt });

  return c.json(row);
});

// Backs HackatimeProjectPicker.svelte. Keyed by the session's own slackId
// (never a client-supplied id) and always the fixed program range — no
// parameters, so a submitter can only see their own Hackatime data and
// can't choose which dates to count.
meRoutes.get("/hackatime-projects", requireAuth, async (c) => {
  const user = c.get("user")!;
  const { start, end } = trackingRange();

  const result = await fetchHackatimeProjects(user.slackId, start, end);
  if (!result) {
    return c.json({ error: "hackatime_unavailable" }, 502);
  }

  return c.json(result);
});

meRoutes.get("/transactions", requireAuth, async (c) => {
  const user = c.get("user")!;
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const pageSize = 20;

  // The stored `reason` (`project:<uuid> approved`) must stay exactly that
  // shape — airtable-sync.ts does an exact-match idempotency check on it.
  // This join only builds a nicer DISPLAY string; the raw column is untouched.
  const rows = await db
    .select({
      id: transactions.id,
      type: transactions.type,
      amount: transactions.amount,
      reason: transactions.reason,
      approvedProjectName: projects.name,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .leftJoin(projects, and(eq(transactions.type, "earned"), eq(transactions.refId, projects.id)))
    .where(eq(transactions.userId, user.id))
    .orderBy(desc(transactions.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json(
    rows.map(({ approvedProjectName, ...row }) => ({
      ...row,
      reason: approvedProjectName ? `Approved: ${approvedProjectName}` : row.reason,
    })),
  );
});
