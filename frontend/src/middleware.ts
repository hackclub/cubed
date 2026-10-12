import { defineMiddleware } from "astro:middleware";
import { getSessionUser, SuspendedError, type Me } from "./lib/api";
import { eligibilityBlockReason } from "./lib/eligibility-copy";

// Checked once a session resolves to a real user, ahead of onboarding/admin
// gating — a hackatime ban or lost YSWS eligibility blocks participation
// outright, regardless of onboarding progress. hackatimeBanned/yswsStatus
// are set at login and re-checked live by the backend at submit/buy and by
// /blocked itself (not per-request), so this is a plain field read, not a
// network call. /blocked reads these same fields to pick its copy.
// This only ever applies to an EXISTING account that later fails the
// check — a brand-new Slack identity that fails it never gets an account
// (or a session) at all; see backend/src/routes/auth.ts + /login-blocked.

declare global {
  namespace App {
    interface Locals {
      user: Me | null;
    }
  }
}

// Truly skipped, no backend call at all — Astro's own internal asset
// requests, which never need to know who's logged in.
const SKIP_ENTIRELY_PREFIXES = ["/_"];

// Name of the backend's session cookie (backend/src/lib/session.ts).
const SESSION_COOKIE = "cubed_session";

// Session resolved but never required for these. "/" and "/login" are
// exact matches; "/docs" is a prefix. Gallery is deliberately NOT here —
// it's only reachable through the dashboard's GalleryPopup now, not browsable logged-out.
const CHECK_BUT_DONT_REQUIRE_EXACT = ["/", "/login", "/suspended", "/age"];
const CHECK_BUT_DONT_REQUIRE_PREFIXES = ["/docs"];

// Only these specifically bounce an anonymous visitor to /login — a
// genuinely unknown path falls through to Astro's own 404 instead, so
// 404.astro's per-section theming still works for logged-out visitors.
const PROTECTED_PREFIXES = ["/dashboard", "/onboarding", "/admin"];

function matchesPrefix(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Production-only (the Vite dev server needs inline scripts and a websocket).
// script-src keeps 'unsafe-inline' because Astro's island hydration, <ClientRouter />
// and a few inline page scripts are inline — Astro's built-in hash-based CSP
// doesn't support <ClientRouter />. Even so this blocks third-party scripts,
// plugins and base-tag tricks, and limits where the page can send data
// (connect-src: itself + the backend API only).
function backendOrigin(): string {
  try {
    // A relative value (same-origin deploy, e.g. "/api") has no origin to add: "self" covers it.
    const { origin } = new URL(import.meta.env.PUBLIC_BACKEND_URL);
    return origin === "null" ? "" : origin;
  } catch {
    return "";
  }
}

const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // https: because project photos, Slack avatars and shop images come from several hosts.
  "img-src 'self' data: blob: https:",
  `connect-src 'self' ${backendOrigin()}`.trim(),
  "object-src 'none'",
  "base-uri 'self'",
  // Chromium also checks every redirect after a form submit against form-action: the landing
  // email form goes /login -> backend -> Hack Club Auth, so all three must be listed.
  `form-action 'self' ${backendOrigin()} https://auth.hackclub.com`.split(/\s+/).join(" "),
  "frame-ancestors 'none'",
].join("; ");

// frame-ancestors 'none' (+ the older X-Frame-Options equivalent for
// browsers that don't read CSP) blocks this app from ever being embedded in
// someone else's iframe — the standard clickjacking defense. Applied to
// every response, including redirects, so there's one place this can't be
// accidentally skipped by a new route.
// Pages are rendered per person (session cookie, role, balance), so no shared cache or the
// back button may keep one around. Build assets under /_ are exempt: they're immutable files.
function withFrameProtection(response: Response, cacheable = false) {
  if (!cacheable && !response.headers.has("Cache-Control")) {
    response.headers.set("Cache-Control", "no-store");
  }
  response.headers.set("Content-Security-Policy", import.meta.env.PROD ? PAGE_CSP : "frame-ancestors 'none'");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

// Resolves the session once per request so every authenticated page/layout
// reads Astro.locals.user instead of each calling the backend separately.
export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;

  if (SKIP_ENTIRELY_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    context.locals.user = null;
    return withFrameProtection(await next(), true);
  }

  const isCheckButDontRequire =
    CHECK_BUT_DONT_REQUIRE_EXACT.includes(pathname) ||
    CHECK_BUT_DONT_REQUIRE_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  let user: Me | null;
  try {
    // No session cookie means nobody to look up: skip the backend call (bots and first-time
    // visitors hitting the landing page would otherwise cost one request each).
    user = context.cookies.has(SESSION_COOKIE) ? await getSessionUser(context.request) : null;
  } catch (err) {
    // A banned account: send them to the explanation page (public pages just
    // render as anonymous, same as a logged-out visitor).
    if (err instanceof SuspendedError) {
      if (!isCheckButDontRequire && matchesPrefix(pathname, PROTECTED_PREFIXES)) {
        return withFrameProtection(context.redirect("/suspended"));
      }
      context.locals.user = null;
      return withFrameProtection(await next());
    }
    // Backend busy/down — NOT the same as logged out. Public pages still
    // render (as anonymous); everything else gets a retry page instead of a
    // misleading bounce to /login.
    if (!isCheckButDontRequire && matchesPrefix(pathname, PROTECTED_PREFIXES)) {
      return withFrameProtection(
        new Response(
          "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Cubed</title><body style='font-family:sans-serif;text-align:center;padding:4rem 1rem'><h1>Cubed is busy right now</h1><p>Please refresh in a few seconds.</p></body>",
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": "10" } },
        ),
      );
    }
    user = null;
  }
  context.locals.user = user;

  if (isCheckButDontRequire) {
    return withFrameProtection(await next());
  }

  if (!user) {
    if (matchesPrefix(pathname, PROTECTED_PREFIXES)) {
      return withFrameProtection(context.redirect("/login"));
    }
    return withFrameProtection(await next());
  }

  // A blocked user only ever sees /blocked — onboarding/admin gating below
  // is skipped entirely while blocked, so there's no path back into the
  // rest of the app (and no redirect loop between /blocked and /onboarding).
  if (eligibilityBlockReason(user.hackatimeBanned, user.yswsStatus)) {
    if (pathname !== "/blocked") {
      return withFrameProtection(context.redirect("/blocked"));
    }
    return withFrameProtection(await next());
  }

  // Every other authenticated route bounces to /onboarding until it's done.
  if (!user.onboardedAt && pathname !== "/onboarding") {
    return withFrameProtection(context.redirect("/onboarding"));
  }

  if (pathname.startsWith("/admin") && !user.isAdmin) {
    return withFrameProtection(context.redirect("/dashboard"));
  }

  return withFrameProtection(await next());
});
