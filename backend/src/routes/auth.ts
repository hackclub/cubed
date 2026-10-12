import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import {
  createSession,
  deleteSession,
  deleteAllSessionsForUser,
  requireAuth,
  SESSION_COOKIE_NAME,
  attachSession,
  type SessionContext,
} from "../lib/session.js";
import { authRateLimit } from "../middleware/rate-limit.js";
import { fetchSlackAvatarUrl } from "../integrations/slack.js";
import { fetchHackatimeTrustLevel } from "../integrations/hackatime.js";
import { checkYswsEligibility } from "../integrations/hackclub-auth.js";
import { eligibilityBlockReason, isIdVerified } from "../lib/eligibility.js";
import {
  AGE_BLOCK_COOKIE_NAME,
  AGE_BLOCK_TTL_S,
  readPendingSignup,
  SIGNUP_COOKIE_NAME,
  SIGNUP_TTL_MS,
  signPendingSignup,
} from "../lib/signup-cookie.js";

const AUTH_BASE_URL = "https://auth.hackclub.com";
const STATE_COOKIE_NAME = "cubed_oauth_state";

// Minimal scope set — Cubed is eligible for broader scopes (legal_name,
// address, phone) but deliberately doesn't request them; the submission/
// fulfillment modals collect that data fresh, in-app, every time instead.
// No `verification_status` scope — eligibility is checked via the public
// `/api/external/check` endpoint below instead (keyed by slack_id, needs no
// scope/consent at all, and distinguishes rejected/over-18/pending, which
// that scope's plain `ysws_eligible` boolean couldn't).
const SCOPES = "openid profile email name slack_id";

export const authRoutes = new Hono<SessionContext>();

authRoutes.get("/login", authRateLimit, (c) => {
  const state = randomBytes(16).toString("hex");

  setCookie(c, STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "Lax",
    maxAge: 60 * 10,
    path: "/",
  });

  const url = new URL("/oauth/authorize", AUTH_BASE_URL);
  url.searchParams.set("client_id", config.hackclubAuth.clientId);
  url.searchParams.set("redirect_uri", config.hackclubAuth.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);

  // Pre-fills Hack Club Auth's sign-in box (useful for people with no account yet).
  const email = c.req.query("email");
  if (email && email.length <= 254) {
    url.searchParams.set("login_hint", email);
  }

  return c.redirect(url.toString());
});

authRoutes.get("/callback", authRateLimit, async (c) => {
  // Distinct from the state mismatch check below, which is the CSRF-relevant case.
  const oauthError = c.req.query("error");
  if (oauthError) {
    // Fixed messages only: echoing error_description would let a crafted link
    // show arbitrary text (e.g. a fake "account suspended, email ...") on our login page.
    const message =
      oauthError === "access_denied"
        ? "You cancelled the login."
        : "Hack Club Auth couldn't log you in. Please try again.";
    return c.redirect(`${config.frontendUrl}/login?error=${encodeURIComponent(message)}`);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  const expectedState = getCookie(c, STATE_COOKIE_NAME);

  // Usually a duplicate callback (double click, refresh, two tabs) or an expired cookie. Only a
  // match consumes the state, so a stray duplicate can't break a login still in flight.
  if (!code || !state || !expectedState || state !== expectedState) {
    if (c.get("user")) {
      return c.redirect(`${config.frontendUrl}/dashboard`);
    }
    return c.redirect(
      `${config.frontendUrl}/login?error=${encodeURIComponent("Your login expired or was opened twice. Please try again.")}`,
    );
  }

  deleteCookie(c, STATE_COOKIE_NAME, { path: "/" });

  const tokenResponse = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.hackclubAuth.clientId,
      client_secret: config.hackclubAuth.clientSecret,
      redirect_uri: config.hackclubAuth.redirectUri,
      code,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) {
    return c.text("Hack Club Auth token exchange failed", 502);
  }
  // The response also includes a refresh_token — deliberately never read or
  // stored. Nothing in this app ever needs to mint a new Hack Club access
  // token without the user going through /login again, and a long-lived
  // credential like that sitting in Postgres would be a real liability if
  // the database were ever breached, for zero actual benefit.
  const token = (await tokenResponse.json()) as {
    access_token: string;
  };

  const meResponse = await fetch(`${AUTH_BASE_URL}/api/v1/me`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!meResponse.ok) {
    return c.text("Hack Club Auth identity fetch failed", 502);
  }
  const me = (await meResponse.json()) as {
    identity: {
      primary_email: string;
      slack_id: string;
    };
  };

  // Hack Club Auth accounts without a linked Slack ID can't be mapped to a
  // user (everything here is keyed on it) — explain instead of crashing.
  if (!me.identity?.slack_id) {
    return c.redirect(
      `${config.frontendUrl}/login?error=${encodeURIComponent("Your Hack Club account has no Slack account linked. Link one at auth.hackclub.com, then try again.")}`,
    );
  }

  // Checked before writing anything — a brand-new Slack identity that
  // fails eligibility must leave zero trace in Postgres (not even a row to
  // later flip a flag on). An *existing* account that later fails this same
  // check is handled completely differently: it keeps its row (still
  // updated below) and gets gated by the frontend's /blocked page instead.
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.slackId, me.identity.slack_id));

  // Both swallow their own errors and return null on a hiccup — an
  // unreachable Hackatime/Auth should never block a login outright. A null
  // result just leaves that field at whatever it already was (or the
  // column default, for a brand-new user); the submit/buy gates
  // (lib/eligibility-check.ts) fail closed on a still-unknown status.
  const [avatarUrl, trustLevel, yswsStatus] = await Promise.all([
    fetchSlackAvatarUrl(me.identity.slack_id),
    fetchHackatimeTrustLevel(me.identity.slack_id),
    checkYswsEligibility(me.identity.slack_id),
  ]);

  const hackatimeBanned = trustLevel === "red";
  const blockReason = eligibilityBlockReason(hackatimeBanned, yswsStatus);

  if (!existing) {
    // Hack Club Auth's check is how we know who is verified. If it can't answer
    // for a brand-new person we don't guess — no account, try again shortly.
    // (Existing accounts keep their stored status through a hiccup.)
    if (yswsStatus === null) {
      return c.redirect(
        `${config.frontendUrl}/login?error=${encodeURIComponent("Hack Club Auth isn't responding right now. Please try again in a few minutes.")}`,
      );
    }
    if (blockReason) {
      return c.redirect(`${config.frontendUrl}/login-blocked?reason=${blockReason}`);
    }
    // Not ID verified: ask their age before creating anything (see lib/signup-cookie.ts).
    if (!isIdVerified(yswsStatus)) {
      // This browser just answered "12 or under" / "19 or older". Only applies
      // here, to unverified newcomers — verified people on a shared computer are unaffected.
      if (getCookie(c, AGE_BLOCK_COOKIE_NAME)) {
        return c.redirect(`${config.frontendUrl}/age?blocked=1`);
      }
      setCookie(
        c,
        SIGNUP_COOKIE_NAME,
        signPendingSignup({
          slackId: me.identity.slack_id,
          email: me.identity.primary_email,
          avatarUrl: avatarUrl ?? null,
          yswsStatus: yswsStatus as "needs_submission" | "pending" | "not_found",
        }),
        { httpOnly: true, secure: config.cookieSecure, sameSite: "Lax", maxAge: SIGNUP_TTL_MS / 1000, path: "/" },
      );
      return c.redirect(`${config.frontendUrl}/age`);
    }
  }

  // Never touches first/last name (legal name, never persisted) or
  // nickname (user-chosen at onboarding). Each field is only added to the
  // update when its fetch succeeded, so a transient failure never wipes an
  // existing value with a null.
  const updateSet: {
    email: string;
    avatarUrl?: string;
    hackatimeBanned?: boolean;
    yswsStatus?: NonNullable<typeof yswsStatus>;
  } = {
    email: me.identity.primary_email,
  };
  if (avatarUrl) updateSet.avatarUrl = avatarUrl;
  if (trustLevel) updateSet.hackatimeBanned = hackatimeBanned;
  if (yswsStatus) updateSet.yswsStatus = yswsStatus;

  const [user] = await db
    .insert(users)
    .values({
      slackId: me.identity.slack_id,
      email: me.identity.primary_email,
      avatarUrl,
      hackatimeBanned,
      yswsStatus,
    })
    .onConflictDoUpdate({
      target: users.slackId,
      set: updateSet,
    })
    .returning({ id: users.id, isBanned: users.isBanned });

  if (user.isBanned) {
    return c.redirect(`${config.frontendUrl}/suspended`);
  }

  const session = await createSession(user.id);

  setCookie(c, SESSION_COOKIE_NAME, session.id, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "Lax",
    expires: session.expiresAt,
    path: "/",
  });

  return c.redirect(`${config.frontendUrl}/dashboard`);
});

authRoutes.post("/logout", attachSession, async (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionId) {
    await deleteSession(sessionId);
  }
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
  return c.body(null, 204);
});

// Ends every session for this user (all devices/browsers), not just this one.
authRoutes.post("/logout-all", requireAuth, async (c) => {
  await deleteAllSessionsForUser(c.get("user")!.id);
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
  return c.body(null, 204);
});

// The age screen's answer. Only reachable with the signed cookie the callback
// set for a brand-new, not-yet-verified person. "13-18" creates the account
// (read-only until they verify, with the declaration recorded); anything else
// stores NOTHING and just drops the cookie.
const ageSchema = z.object({ band: z.enum(["12_or_under", "13_18", "19_plus"]) });

authRoutes.post("/age", authRateLimit, bodyLimit({ maxSize: 4 * 1024 }), zValidator("json", ageSchema), async (c) => {
  const { band } = c.req.valid("json");
  const pending = readPendingSignup(getCookie(c, SIGNUP_COOKIE_NAME));
  if (!pending) {
    return c.json({ error: "signup_expired" }, 400);
  }
  deleteCookie(c, SIGNUP_COOKIE_NAME, { path: "/" });

  if (band !== "13_18") {
    setCookie(c, AGE_BLOCK_COOKIE_NAME, "1", {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "Lax",
      maxAge: AGE_BLOCK_TTL_S,
      path: "/",
    });
    return c.json({ blocked: true });
  }

  const [user] = await db
    .insert(users)
    .values({
      slackId: pending.slackId,
      email: pending.email,
      avatarUrl: pending.avatarUrl,
      yswsStatus: pending.yswsStatus,
      ageDeclaredAt: new Date(),
    })
    .onConflictDoUpdate({ target: users.slackId, set: { email: pending.email } })
    .returning({ id: users.id, isBanned: users.isBanned });

  if (user.isBanned) {
    return c.json({ suspended: true });
  }

  const session = await createSession(user.id);
  setCookie(c, SESSION_COOKIE_NAME, session.id, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "Lax",
    expires: session.expiresAt,
    path: "/",
  });

  return c.json({ next: "/dashboard" });
});
