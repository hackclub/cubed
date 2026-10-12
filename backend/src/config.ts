import "dotenv/config";

// Validated once at import time — fails loud at boot instead of a cryptic
// downstream error. Everything else reads `config.x`, not `process.env.x`.
const required = [
  "DATABASE_URL",
  "FRONTEND_ORIGINS",
  "FRONTEND_URL",
  "HACKCLUB_AUTH_CLIENT_ID",
  "HACKCLUB_AUTH_CLIENT_SECRET",
  "HACKCLUB_AUTH_REDIRECT_URI",
  "AIRTABLE_PAT",
  "AIRTABLE_BASE_ID",
  "AIRTABLE_SUBMISSIONS_TABLE_ID",
  "AIRTABLE_SCREENSHOT_FIELD_ID",
  "AIRTABLE_SHOP_ITEMS_TABLE_ID",
  "AIRTABLE_FULFILLMENT_TABLE_ID",
] as const;

// SLACK_BOT_TOKEN and HACKCLUB_CDN_API_KEY are deliberately not required —
// both are nice-to-haves layered on a working app (avatars, showcase
// photos), not reasons to refuse to boot. Unset just means a graceful
// fallback downstream (initial-letter avatar; a 503 from the photo routes).

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Missing required env vars: ${missing.join(", ")}`);
}

// A deploy that forgets NODE_ENV would run with the dev-friendly defaults of everything that keys
// off it, so anything other than development or production refuses to boot.
const nodeEnv = process.env.NODE_ENV;
if (nodeEnv !== "development" && nodeEnv !== "production") {
  throw new Error('NODE_ENV must be set to "production" (or "development" locally)');
}

const isDevelopment = process.env.NODE_ENV === "development";

// Which direct peers may tell us the real client IP (via X-Real-IP). Anyone else's
// header is ignored, so a client reaching the backend directly can't pick its own
// rate-limit bucket. Comma-separated IPs/CIDRs; "*" = trust every peer (only if the
// backend is reachable solely through your ingress/frontend). Required outside development.
const DEV_TRUSTED_PROXIES = "127.0.0.0/8,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7";
if (!isDevelopment && !process.env.TRUSTED_PROXIES) {
  throw new Error("Missing required env var: TRUSTED_PROXIES (see backend/.env.example)");
}
if (!isDevelopment && !process.env.COOKIE_SIGNING_SECRET) {
  throw new Error("Missing required env var: COOKIE_SIGNING_SECRET (see backend/.env.example)");
}

if (nodeEnv === "production") {
  const insecure = [
    ["FRONTEND_URL", process.env.FRONTEND_URL!],
    ["HACKCLUB_AUTH_REDIRECT_URI", process.env.HACKCLUB_AUTH_REDIRECT_URI!],
    ...process.env.FRONTEND_ORIGINS!.split(",").map((origin) => ["FRONTEND_ORIGINS", origin.trim()] as const),
  ].filter(([, value]) => value && !value.toLowerCase().startsWith("https://"));
  if (insecure.length > 0) {
    throw new Error(`Production needs https URLs: ${[...new Set(insecure.map(([name]) => name))].join(", ")}`);
  }
  if ((process.env.COOKIE_SIGNING_SECRET ?? "").length < 32) {
    throw new Error("COOKIE_SIGNING_SECRET must be at least 32 characters in production");
  }
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  trustedProxies: (process.env.TRUSTED_PROXIES ?? DEV_TRUSTED_PROXIES)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
  // Signs the short-lived signup cookie. Separate from the OAuth client secret so
  // rotating or leaking one doesn't affect the other (dev falls back to a derived key).
  cookieSigningSecret: process.env.COOKIE_SIGNING_SECRET ?? "",
  // Secure unless explicitly in dev: a prod deploy that forgets NODE_ENV must
  // not quietly send the session cookie over plain HTTP. (Browsers still accept
  // Secure cookies on http://localhost.)
  cookieSecure: process.env.NODE_ENV !== "development",
  databaseUrl: process.env.DATABASE_URL!,
  frontendOrigins: process.env
    .FRONTEND_ORIGINS!.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  frontendUrl: process.env.FRONTEND_URL!,
  // Hackatime hours count from here, fixed for everyone (users can't pick a
  // date range). Not an env var on purpose — it's a program rule, not deploy config.
  programStartDate: "2026-06-01",
  // ...and stop counting here, whatever day they submit.
  programEndDate: "2026-11-10",
  hackclubAuth: {
    clientId: process.env.HACKCLUB_AUTH_CLIENT_ID!,
    clientSecret: process.env.HACKCLUB_AUTH_CLIENT_SECRET!,
    redirectUri: process.env.HACKCLUB_AUTH_REDIRECT_URI!,
  },
  airtable: {
    pat: process.env.AIRTABLE_PAT!,
    baseId: process.env.AIRTABLE_BASE_ID!,
    submissionsTableId: process.env.AIRTABLE_SUBMISSIONS_TABLE_ID!,
    screenshotFieldId: process.env.AIRTABLE_SCREENSHOT_FIELD_ID!,
    shopItemsTableId: process.env.AIRTABLE_SHOP_ITEMS_TABLE_ID!,
    fulfillmentTableId: process.env.AIRTABLE_FULFILLMENT_TABLE_ID!,
    // Optional: without it the Users sync is off and admin/ban flags stay database-only.
    usersTableId: process.env.AIRTABLE_USERS_TABLE_ID ?? "",
    usersSyncIntervalSeconds: Math.max(5, Number(process.env.AIRTABLE_USERS_SYNC_INTERVAL_SECONDS) || 30),
    // Floored at 1s: 0 or a non-number would make setInterval fire about every ms.
    syncIntervalSeconds: Math.max(1, Number(process.env.AIRTABLE_SYNC_INTERVAL_SECONDS) || 10),
  },
  // Optional newsletter audience table (jobs/loops-sync.ts). Off when the table id is unset.
  loops: {
    tableId: process.env.AIRTABLE_LOOPS_TABLE_ID ?? "",
    // lowerCamelCase program slug from the Unified YSWS database; names the attribute fields.
    programSlug: (process.env.LOOPS_PROGRAM_SLUG ?? "").trim(),
    syncIntervalSeconds: Math.max(30, Number(process.env.LOOPS_SYNC_INTERVAL_SECONDS) || 300),
  },
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN ?? "",
  },
  hackclubCdn: {
    apiKey: process.env.HACKCLUB_CDN_API_KEY ?? "",
  },
};
