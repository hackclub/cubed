import type { APIRoute } from "astro";

// Liveness for the frontend container; deliberately never calls the backend.
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
