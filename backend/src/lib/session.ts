import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";
import { db } from "../db/client.js";
import { sessions, userActivity, users } from "../db/schema.js";
import type { YswsStatus } from "../integrations/hackclub-auth.js";
import { eligibilityBlockReason, isIdVerified } from "./eligibility.js";

// Sliding: a session expires after 14 idle days (renewed when used, at most once a
// day) and never lives longer than 90 days in total, whatever the activity.
const DAY_MS = 1000 * 60 * 60 * 24;
const SESSION_IDLE_TTL_MS = 14 * DAY_MS;
const SESSION_MAX_AGE_MS = 90 * DAY_MS;

export const SESSION_COOKIE_NAME = "cubed_session";

export function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

// Only a hash is stored: the raw token lives in the cookie alone, so a leaked
// database dump (or backup) can't be replayed as live sessions. The token is
// 256 random bits, so a plain unsalted SHA-256 is enough — there is nothing to brute-force.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Returns the RAW token (for the cookie) as `id`; the database gets its hash.
export async function createSession(userId: string) {
  const id = generateSessionId();
  const now = Date.now();

  await db.insert(sessions).values({ id: hashToken(id), userId, expiresAt: new Date(now + SESSION_IDLE_TTL_MS) });

  // The cookie lives for the absolute maximum; the server-side expiry above is what
  // actually ends an idle session.
  return { id, expiresAt: new Date(now + SESSION_MAX_AGE_MS) };
}

export type SessionLookup =
  | { status: "ok"; user: SessionUser }
  | { status: "banned" }
  | { status: "none" };

export async function lookupSession(sessionToken: string): Promise<SessionLookup> {
  const rows = await db
    .select({
      expiresAt: sessions.expiresAt,
      sessionCreatedAt: sessions.createdAt,
      id: users.id,
      slackId: users.slackId,
      email: users.email,
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
      isAdmin: users.isAdmin,
      isBanned: users.isBanned,
      hackatimeBanned: users.hackatimeBanned,
      yswsStatus: users.yswsStatus,
      molesBalance: users.molesBalance,
      onboardedAt: users.onboardedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, hashToken(sessionToken)));

  if (rows.length === 0) {
    return { status: "none" };
  }

  const { expiresAt, sessionCreatedAt, isBanned, ...user } = rows[0];
  const now = Date.now();
  // Expired when idle too long, or when it has simply lived past the absolute maximum.
  if (expiresAt.getTime() < now || sessionCreatedAt.getTime() + SESSION_MAX_AGE_MS < now) {
    return { status: "none" };
  }
  // Renew the idle window (at most once a day), capped by the absolute maximum.
  if (expiresAt.getTime() - now < SESSION_IDLE_TTL_MS - DAY_MS) {
    const renewed = Math.min(now + SESSION_IDLE_TTL_MS, sessionCreatedAt.getTime() + SESSION_MAX_AGE_MS);
    if (renewed > expiresAt.getTime()) {
      db.update(sessions)
        .set({ expiresAt: new Date(renewed) })
        .where(eq(sessions.id, hashToken(sessionToken)))
        .catch(() => {});
    }
  }
  // Checked here (not just at login) so a ban takes effect immediately, even
  // against a session issued before the ban. The session row is KEPT while
  // the ban lasts so every request keeps answering "suspended" (the frontend
  // shows the suspended page); lifting the ban deletes the user's sessions
  // (jobs/users-sync.ts), so an old login is never silently resurrected.
  if (isBanned) {
    return { status: "banned" };
  }

  return { status: "ok", user };
}

export async function deleteSession(sessionToken: string) {
  await db.delete(sessions).where(eq(sessions.id, hashToken(sessionToken)));
}

export async function deleteAllSessionsForUser(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export type SessionUser = {
  id: string;
  slackId: string;
  email: string;
  nickname: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  hackatimeBanned: boolean;
  yswsStatus: YswsStatus | null;
  molesBalance: number;
  onboardedAt: Date | null;
};

export type SessionContext = {
  Variables: {
    user: SessionUser | null;
    // True when a valid session belongs to a banned user.
    suspended?: boolean;
  };
};

// Admin activity metrics: last-seen time (throttled) and one row per user per UTC day.
// Fire-and-forget and in-memory throttled so it adds no latency and ~1 write per
// active user per couple of minutes; a failure here must never fail a request.
const TOUCH_EVERY_MS = 2 * 60_000;
const lastTouched = new Map<string, number>();

function recordActivity(userId: string) {
  const now = Date.now();
  if (now - (lastTouched.get(userId) ?? 0) < TOUCH_EVERY_MS) return;
  if (lastTouched.size > 10_000) lastTouched.clear();
  lastTouched.set(userId, now);

  const today = new Date(now).toISOString().slice(0, 10);
  db.update(users)
    .set({ lastSeenAt: new Date(now) })
    .where(eq(users.id, userId))
    .then(() => db.insert(userActivity).values({ userId, day: today }).onConflictDoNothing())
    .catch(() => {});
}

// Populates c.get("user") when a valid session cookie is present, but never
// rejects — mounted globally, ahead of both public and authenticated routes.
export const attachSession = createMiddleware<SessionContext>(async (c, next) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  const lookup = sessionId ? await lookupSession(sessionId) : ({ status: "none" } as const);
  if (lookup.status === "ok") recordActivity(lookup.user.id);
  c.set("user", lookup.status === "ok" ? lookup.user : null);
  c.set("suspended", lookup.status === "banned");
  return next();
});

export const requireAuth = createMiddleware<SessionContext>(async (c, next) => {
  if (!c.get("user")) {
    if (c.get("suspended")) {
      throw new HTTPException(403, { res: Response.json({ error: "suspended" }, { status: 403 }) });
    }
    throw new HTTPException(401, { message: "Not authenticated" });
  }
  return next();
});

// For write routes (create/edit projects, photo upload): a banned or
// ineligible user shouldn't be able to keep working through the API just
// because the frontend's /blocked redirect only stops page loads. Uses the
// stored flags (kept fresh at login, submit/buy and /blocked), no network call.
export const requireNotBlocked = createMiddleware<SessionContext>(async (c, next) => {
  const user = c.get("user")!;
  const reason = eligibilityBlockReason(user.hackatimeBanned, user.yswsStatus);
  if (reason) {
    return c.json({ error: "not_eligible", reason }, 403);
  }
  return next();
});

// Actions only ID-verified people may take (upvoting). Uses the stored status,
// which is refreshed at login, at submit/buy, and by the "I've verified" button.
export const requireVerified = createMiddleware<SessionContext>(async (c, next) => {
  if (!isIdVerified(c.get("user")!.yswsStatus)) {
    return c.json({ error: "not_verified" }, 403);
  }
  return next();
});

export const requireAdmin = createMiddleware<SessionContext>(async (c, next) => {
  const user = c.get("user");
  if (!user?.isAdmin) {
    throw new HTTPException(403, { message: "Admin only" });
  }
  return next();
});
