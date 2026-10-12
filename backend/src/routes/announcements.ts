import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { announcementReads, announcements } from "../db/schema.js";
import { requireAuth, type SessionContext } from "../lib/session.js";

export const announcementReadRoutes = new Hono<SessionContext>();

// Table-qualified as raw SQL text, not interpolated Drizzle columns — same
// unqualified-identifier gotcha as the upvote subquery in routes/projects.ts.
announcementReadRoutes.get("/", requireAuth, async (c) => {
  const user = c.get("user")!;

  const rows = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      createdAt: announcements.createdAt,
      isRead: sql<boolean>`exists(select 1 from announcement_reads where announcement_reads.announcement_id = announcements.id and announcement_reads.user_id = ${user.id})`,
    })
    .from(announcements)
    .orderBy(desc(announcements.createdAt));

  return c.json(rows);
});

// Same toggle pattern as POST /gallery/:id/upvote — one endpoint for both
// mark-read and mark-unread.
announcementReadRoutes.post("/:id/read", requireAuth, async (c) => {
  const user = c.get("user")!;
  const announcementId = c.req.param("id");

  const result = await db.transaction(async (tx) => {
    const [announcement] = await tx
      .select({ id: announcements.id })
      .from(announcements)
      .where(eq(announcements.id, announcementId));
    if (!announcement) {
      return { error: "not_found" as const };
    }

    const [existing] = await tx
      .select({ id: announcementReads.id })
      .from(announcementReads)
      .where(and(eq(announcementReads.announcementId, announcementId), eq(announcementReads.userId, user.id)));

    if (existing) {
      await tx.delete(announcementReads).where(eq(announcementReads.id, existing.id));
    } else {
      await tx
        .insert(announcementReads)
        .values({ announcementId, userId: user.id })
        .onConflictDoNothing();
    }

    return { isRead: !existing };
  });

  if ("error" in result) {
    return c.json({ error: result.error }, 404);
  }

  return c.json(result);
});
