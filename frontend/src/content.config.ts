// Adding a doc page is just "drop a .md file in src/content/docs" — no
// database involved; pages/docs/[...slug].astro builds nav from this at request time.
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const docs = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/docs" }),
  schema: z.object({
    title: z.string(),
    // Lower shows first; defaults to 0 so a new doc doesn't need one.
    order: z.number().default(0),
    // Grouping label for DocsNav.astro's sidebar (e.g. "Start Here") — optional.
    section: z.string().optional(),
    // <meta name="description">/OG description for this page — optional,
    // falls back to a generic docs description in DocsLayout.astro.
    description: z.string().optional(),
  }),
});

export const collections = { docs };
