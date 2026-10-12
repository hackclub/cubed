import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import { projectUpvotes, projects, users } from "../db/schema.js";
import { requireAuth, requireVerified, type SessionContext } from "../lib/session.js";

export const galleryRoutes = new Hono<SessionContext>();

const PAGE_SIZE = 24;

// Drafts are public on purpose (product decision); rejected projects never are.
const GALLERY_STATUSES = ["draft", "submitted", "approved"] as const;

// Every gallery route requires a login (the data is about minors). What it may show is
// enforced here once rather than trusted to the frontend: drafts, submitted and approved projects (never rejected ones),
// not hidden by an admin, and owned by someone who is ID verified and not
// banned (team ban or Hackatime ban). Everything of an unverified or banned
// owner disappears from the gallery entirely.
// Admins skip the hidden filter so they can find and unhide things.
function visibleConditions(isAdmin: boolean): SQL[] {
  return [
    inArray(projects.status, [...GALLERY_STATUSES]),
    eq(users.yswsStatus, "verified_eligible"),
    eq(users.isBanned, false),
    eq(users.hackatimeBanned, false),
    ...(isAdmin ? [] : [eq(projects.hidden, false)]),
  ];
}

// `q` (name search), `status`, `sort`, `userId` (one user's projects — powers
// the "view all of this person's projects" pfp click) and `page` are all
// optional. status can only be draft/submitted/approved: rejected projects
// are never shown, whatever the filter says.
const gallerySearchSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(GALLERY_STATUSES).optional(),
  userId: z.string().uuid().optional(),
  sort: z.enum(["recent", "upvotes"]).default("recent"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

const idParamSchema = z.object({ id: z.string().uuid() });

// Table-qualified as raw SQL text — the query has a JOIN so Drizzle would
// qualify columns correctly anyway, but relying on that broke silently in
// routes/projects.ts's JOIN-less version of this same subquery.
const upvoteCountSql = sql<number>`(select count(*)::int from project_upvotes where project_upvotes.project_id = projects.id)`;

// Public response — never email. slackId and `hidden` are admin-only (added
// conditionally). userId IS included on purpose — it's how the frontend
// links a project's submitter avatar to "view all of this user's projects".
// repoUrl/demoUrl ARE included on purpose too: visitors seeing a project's
// code/demo is the point.
function galleryColumns(viewer: { id: string; isAdmin: boolean } | null) {
  return {
    id: projects.id,
    name: projects.name,
    description: projects.description,
    status: projects.status,
    photoUrl: projects.photoUrl,
    repoUrl: projects.repoUrl,
    demoUrl: projects.demoUrl,
    userId: projects.userId,
    nickname: users.nickname,
    avatarUrl: users.avatarUrl,
    hackatimeSeconds: projects.hackatimeSeconds,
    viewCount: projects.viewCount,
    upvoteCount: upvoteCountSql,
    viewerHasUpvoted: viewer
      ? sql<boolean>`exists(select 1 from project_upvotes where project_upvotes.project_id = projects.id and project_upvotes.user_id = ${viewer.id})`
      : sql<boolean>`false`,
    ...(viewer?.isAdmin ? { slackId: users.slackId, hidden: projects.hidden } : {}),
  };
}

galleryRoutes.get("/", requireAuth, zValidator("query", gallerySearchSchema), async (c) => {
  // null for a logged-out visitor — used for viewerHasUpvoted and the
  // admin-only columns.
  const viewer = c.get("user");
  const { q, status, userId, sort, page } = c.req.valid("query");

  const conditions = visibleConditions(Boolean(viewer?.isAdmin));
  // Escape LIKE wildcards so a search for "%" or "_" is literal, not match-everything.
  if (q) conditions.push(ilike(projects.name, `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`));
  if (status) conditions.push(eq(projects.status, status));
  if (userId) conditions.push(eq(projects.userId, userId));

  const order =
    sort === "upvotes"
      ? [desc(upvoteCountSql), desc(projects.createdAt)]
      : [sql`case when ${projects.status} = 'approved' then 0 else 1 end`, desc(projects.createdAt)];

  // One extra row tells us whether another page exists without a count query.
  const rows = await db
    .select(galleryColumns(viewer))
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(and(...conditions))
    .orderBy(...order, asc(projects.id))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);

  return c.json({ items: rows.slice(0, PAGE_SIZE), page, hasMore: rows.length > PAGE_SIZE });
});

// Single project, for deep links (`?gallery=<id>`) to something that isn't on
// the first page. Same visibility rules as the list.
galleryRoutes.get("/:id", requireAuth, zValidator("param", idParamSchema), async (c) => {
  const viewer = c.get("user");
  const { id } = c.req.valid("param");

  const [row] = await db
    .select(galleryColumns(viewer))
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(and(eq(projects.id, id), ...visibleConditions(Boolean(viewer?.isAdmin))));

  if (!row) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json(row);
});

// Not restricted to non-owners — upvoting your own project is a little
// silly but low-stakes, not worth the extra ownership-lookup complexity.
galleryRoutes.post("/:id/upvote", requireAuth, requireVerified, zValidator("param", idParamSchema), async (c) => {
  const user = c.get("user")!;
  const { id: projectId } = c.req.valid("param");

  const result = await db.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(users, eq(projects.userId, users.id))
      .where(and(eq(projects.id, projectId), ...visibleConditions(user.isAdmin)));
    if (!project) {
      return { error: "not_found" as const };
    }

    const [existing] = await tx
      .select({ id: projectUpvotes.id })
      .from(projectUpvotes)
      .where(and(eq(projectUpvotes.projectId, projectId), eq(projectUpvotes.userId, user.id)));

    if (existing) {
      await tx.delete(projectUpvotes).where(eq(projectUpvotes.id, existing.id));
    } else {
      await tx.insert(projectUpvotes).values({ projectId, userId: user.id }).onConflictDoNothing();
    }

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(projectUpvotes)
      .where(eq(projectUpvotes.projectId, projectId));

    return { upvoted: !existing, upvoteCount: count };
  });

  if ("error" in result) {
    return c.json({ error: result.error }, 404);
  }

  return c.json(result);
});

// Naive increment, no per-viewer dedup, on purpose (see viewCount's comment in
// schema.ts). Only counts projects the gallery actually shows.
galleryRoutes.post("/:id/view", requireAuth, zValidator("param", idParamSchema), async (c) => {
  const { id: projectId } = c.req.valid("param");

  const [row] = await db
    .update(projects)
    .set({ viewCount: sql`${projects.viewCount} + 1` })
    .where(
      and(
        eq(projects.id, projectId),
        inArray(projects.status, [...GALLERY_STATUSES]),
        eq(projects.hidden, false),
        sql`exists (select 1 from users where users.id = projects.user_id and users.ysws_status = 'verified_eligible' and users.is_banned = false and users.hackatime_banned = false)`,
      ),
    )
    .returning({ viewCount: projects.viewCount });

  if (!row) {
    return c.json({ error: "not_found" }, 404);
  }

  return c.json({ viewCount: row.viewCount });
});
