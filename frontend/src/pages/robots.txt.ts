// A .ts endpoint (not a static public/robots.txt) so the Sitemap: line
// stays derived from astro.config.mjs's `site` instead of a second
// hardcoded copy of the domain. Disallowed paths mirror middleware.ts's
// PROTECTED_PREFIXES plus the utility/error pages that also set
// noindex — keep both lists in sync if either changes.
import type { APIRoute } from "astro";

const DISALLOWED = ["/dashboard", "/onboarding", "/admin", "/login", "/login-blocked", "/blocked"];

export const GET: APIRoute = ({ site }) => {
  const body = [
    "User-agent: *",
    "Allow: /",
    ...DISALLOWED.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${new URL("sitemap-index.xml", site)}`,
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
