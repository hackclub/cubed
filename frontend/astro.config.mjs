// @ts-check
import { defineConfig } from 'astro/config';

import svelte from '@astrojs/svelte';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';

import tailwindcss from '@tailwindcss/vite';

const SITE = 'https://cubed.hackclub.com';

// Real content pages only — every doc slug in src/content/docs/, kept in
// sync by hand (see the sitemap note below for why this can't be
// auto-discovered). "/docs/" itself (the index) is deliberately excluded:
// it's a redirect to the lowest-order doc, not a real page.
const DOC_SLUGS = ['getting-started', 'what-counts', 'rules', 'faq', 'shipping', 'the-shop', 'hackatime', 'good-journaling'];

// SSR is needed for the authenticated app routes (/dashboard, /onboarding,
// /admin, ...), which check the session cookie server-side before
// rendering. The landing page at "/" is unaffected.
export default defineConfig({
  site: SITE,
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    svelte(),
    // Everything meaningful here is login-gated (dashboard/onboarding/admin)
    // or a utility/error page (login, blocked, 404) — none of that belongs
    // in a public sitemap. `/docs/[...slug]` is looked up per-request
    // (getEntry, not getStaticPaths — see that file's own comment), so the
    // integration can't discover those doc pages on its own either;
    // `customPages` lists them explicitly instead.
    sitemap({
      // `filter` runs on customPages too, not just auto-discovered routes —
      // it has to explicitly allow both, or customPages silently get
      // filtered back out (this bit us once already: the first version of
      // this only allowed '/' and dropped every doc page from the sitemap).
      filter: (page) => page === `${SITE}/` || DOC_SLUGS.some((slug) => page === `${SITE}/docs/${slug}`),
      customPages: DOC_SLUGS.map((slug) => `${SITE}/docs/${slug}`),
    }),
  ],

  vite: {
    plugins: [tailwindcss()]
  }
});