// Server-side (Astro SSR) fetch helper — forwards the incoming request's
// session cookie to the backend so route handlers can check auth before
// rendering. Never call this from the browser.
//
// Also forwards the visitor's IP (set by the ingress as X-Real-IP, which it
// overwrites, so a client can't forge it). Without this every SSR call
// reaches the backend with no client IP, and the backend's per-IP rate
// limiter lumps the whole site into a single bucket. Safe only because the
// backend is reachable solely through that same ingress (which overwrites
// X-Real-IP on public calls) or from this frontend over the internal network.
// Read from process.env at request time: import.meta.env.BACKEND_URL is replaced at BUILD time,
// and the Docker build has no such variable, so it would be undefined in the running image.
export function serverBackendUrl(): string {
  const url = process.env.BACKEND_URL ?? import.meta.env.BACKEND_URL;
  if (!url) throw new Error("BACKEND_URL is not set");
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export async function serverApiFetch(request: Request, path: string, init: RequestInit = {}) {
  const backendUrl = serverBackendUrl();
  const cookie = request.headers.get("cookie") ?? "";
  const clientIp = request.headers.get("x-real-ip");

  return fetch(`${backendUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      cookie,
      ...(clientIp ? { "x-real-ip": clientIp } : {}),
    },
  });
}

// Mirrors backend/src/integrations/hackclub-auth.ts's YswsStatus exactly.
export type YswsStatus =
  | "needs_submission"
  | "pending"
  | "verified_eligible"
  | "verified_but_over_18"
  | "rejected"
  | "not_found";

export type Me = {
  id: string;
  slackId: string;
  email: string;
  nickname: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  hackatimeBanned: boolean;
  yswsStatus: YswsStatus | null;
  molesBalance: number;
  onboardedAt: string | null;
};

export class BackendUnavailableError extends Error {}

// The session is valid but the account is banned (backend answers 403 "suspended").
export class SuspendedError extends Error {}

// null means "not logged in" and nothing else. A 429, a 5xx, or an unreachable
// backend throws instead — treating those as "logged out" bounced real users
// to the login page whenever the backend was merely busy.
export async function getSessionUser(request: Request): Promise<Me | null> {
  let response: Response;
  try {
    response = await serverApiFetch(request, "/me", { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new BackendUnavailableError();
  }
  if (response.status === 401) return null;
  if (response.status === 403) {
    const body = await response.json().catch(() => null);
    if (body?.error === "suspended") throw new SuspendedError();
  }
  if (!response.ok) throw new BackendUnavailableError();
  return await response.json();
}
