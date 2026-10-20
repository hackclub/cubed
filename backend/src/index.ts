import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "drizzle-orm";
import { config } from "./config.js";
import { db, closeDb } from "./db/client.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { corsMiddleware } from "./middleware/cors.js";
import { requireCsrfHeader } from "./middleware/csrf.js";
import { globalRateLimit, userRateLimit } from "./middleware/rate-limit.js";
import { attachSession, deleteExpiredSessions, type SessionContext } from "./lib/session.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { projectRoutes } from "./routes/projects.js";
import { galleryRoutes } from "./routes/gallery.js";
import { shopRoutes } from "./routes/shop.js";
import { adminRoutes, internalRoutes } from "./routes/admin.js";
import { announcementReadRoutes } from "./routes/announcements.js";
import { scheduleAirtableSync } from "./jobs/airtable-sync.js";
import { scheduleUsersSync } from "./jobs/users-sync.js";
import { scheduleLoopsSync } from "./jobs/loops-sync.js";
import { scheduleMaintenance } from "./jobs/maintenance.js";
import { scheduleHackatimeActivitySync } from "./jobs/hackatime-activity.js";

// Mounted under /api so a reverse proxy can share one domain with the Astro
// frontend without colliding with a frontend page of the same name.
const api = new Hono<SessionContext>();

api.use(securityHeaders);
api.use(corsMiddleware);
api.use(globalRateLimit);
api.use(requireCsrfHeader);
api.use(attachSession);
api.use(userRateLimit);

api.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  // A malformed id in a URL (e.g. /projects/not-a-uuid) makes Postgres reject
  // the value (22P02) — that's a bad request, not a server error.
  const pgError = (err as { cause?: unknown }).cause ?? err;
  const { code: pgCode, constraint_name: constraint } = pgError as { code?: string; constraint_name?: string };
  if (pgCode === "22P02") {
    return c.json({ error: "Invalid request" }, 400);
  }
  // Unique violation — the only one a user can realistically trigger is
  // picking a nickname someone else already has.
  if (pgCode === "23505") {
    return c.json({ error: constraint === "users_nickname_lower_unique" ? "nickname_taken" : "conflict" }, 409);
  }
  // A failed query's message ends with its parameters (emails, Slack ids, project text),
  // so only the message before them and the stack frames are logged.
  const message = err instanceof Error ? err.message.split("\nparams:")[0] : String(err);
  const frames = err instanceof Error ? (err.stack ?? "").split("\n").filter((line) => line.trim().startsWith("at ")).slice(0, 8) : [];
  console.error("Unhandled error:", message, pgCode ? `(postgres ${pgCode})` : "", frames.join("\n"));
  return c.json({ error: "Internal server error" }, 500);
});

// Liveness: the process is up and answering. Never touches the database, so a Postgres blip
// can't make an orchestrator restart a healthy process.
api.get("/livez", (c) => c.json({ ok: true }));

// Readiness (and the older /health): actually checks Postgres, so traffic is only routed to an
// instance that can serve it.
async function readiness(c: Context) {
  try {
    await db.execute(sql`select 1`);
    return c.json({ ok: true });
  } catch (err) {
    console.error("Health check: database unreachable", err instanceof Error ? err.message : err);
    return c.json({ ok: false, error: "database unreachable" }, 503);
  }
}
api.get("/readyz", readiness);
api.get("/health", readiness);

api.route("/auth", authRoutes);
api.route("/me", meRoutes);
api.route("/projects", projectRoutes);
api.route("/gallery", galleryRoutes);
api.route("/shop", shopRoutes);
api.route("/admin", adminRoutes);
api.route("/internal", internalRoutes);
api.route("/announcements", announcementReadRoutes);

const app = new Hono().route("/api", api);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Cubed backend listening on http://localhost:${info.port}`);
});

scheduleAirtableSync();
scheduleUsersSync();
scheduleLoopsSync();
scheduleMaintenance();
scheduleHackatimeActivitySync();

// Periodic cleanup of expired session rows.
setInterval(() => {
  deleteExpiredSessions().catch((err) => console.error("Session cleanup failed", err));
}, 60 * 60 * 1000);

// An orchestrator sends SIGTERM before killing the process on every deploy/
// restart — without this, in-flight requests get dropped mid-response and
// Postgres connections are left to time out instead of closing cleanly.
// The force-exit timeout is a backstop in case a connection never drains.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    closeDb().finally(() => process.exit(0));
  });
  // Idle keep-alive connections would otherwise hold close() open until they time out.
  (server as Server).closeIdleConnections();
  // A submit can be mid-way through its Airtable calls (tens of seconds under the pacer), so
  // in-flight requests get 25s, below the usual 30s container stop grace period.
  setTimeout(() => {
    (server as Server).closeAllConnections();
    process.exit(1);
  }, 25_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
