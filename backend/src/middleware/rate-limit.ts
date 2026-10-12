// globalRateLimit: blanket per-IP ceiling, abuse-cost protection only —
// nothing correctness-dependent relies on it. authRateLimit: tighter, on
// /auth/login and /auth/callback only.
//
// No per-action limits on submit/buy on purpose: double-submission is
// blocked by the project status check (routes/projects.ts), double-spending
// by the row lock in the buy transaction (routes/shop.ts) — both hold with
// or without a rate limiter on top.

import { rateLimiter } from "hono-rate-limiter";
import type { Context } from "hono";
import { clientIp } from "../lib/client-ip.js";

// SSR page loads reach us from the frontend with the visitor's IP forwarded in
// X-Real-IP (frontend/src/lib/api.ts), so each visitor gets their own bucket.
// lib/client-ip.ts only believes that header from a trusted peer (TRUSTED_PROXIES);
// everyone else is keyed on the socket address.
//
// In-memory — correct for one instance only. Multiple instances behind a
// load balancer would each enforce the limit independently, so the real
// combined ceiling would quietly multiply.
function keyForPublicRoute(c: Context) {
  return `ip:${clientIp(c)}`;
}

// Generous on purpose: one dashboard load makes several calls, and a school or event network puts
// many people behind one address. It only has to stop a runaway script, not shape normal use.
// Probes are exempt so an orchestrator's checks can never be throttled.
export const globalRateLimit = rateLimiter({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: "draft-6",
  keyGenerator: keyForPublicRoute,
  skip: (c) => c.req.path.endsWith("/livez") || c.req.path.endsWith("/readyz") || c.req.path.endsWith("/health"),
});

// Per signed-in person, so one noisy account can't spend a shared address's budget and a shared
// address can't starve everyone on it. Runs after attachSession; anonymous requests are skipped
// (the per-IP limit above covers them).
export const userRateLimit = rateLimiter({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: "draft-6",
  keyGenerator: (c) => `user:${(c.get("user" as never) as { id: string } | undefined)?.id ?? clientIp(c)}`,
  skip: (c) => !c.get("user" as never),
});

// Tighter than the global limit — these are the routes worth brute-forcing
// (OAuth state guessing, callback replay).
export const authRateLimit = rateLimiter({
  windowMs: 60_000,
  limit: 8,
  standardHeaders: "draft-6",
  keyGenerator: keyForPublicRoute,
});
