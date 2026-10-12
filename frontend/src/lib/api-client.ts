// Talks directly to the backend — sends the session
// cookie via `credentials` and the header the backend's CSRF middleware requires.
const BACKEND_URL = import.meta.env.PUBLIC_BACKEND_URL;

export async function apiFetch(path: string, init: RequestInit = {}) {
  const method = (init.method ?? "GET").toUpperCase();
  const needsCsrfHeader = method !== "GET" && method !== "HEAD";

  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...init.headers,
      ...(needsCsrfHeader ? { "X-Requested-With": "cubed" } : {}),
    },
  });

  // A ban made while someone is mid-session: any call answers 403 "suspended".
  // Send them to the explanation page instead of leaving buttons failing quietly.
  if (response.status === 403) {
    const body = await response.clone().json().catch(() => null);
    if (body?.error === "suspended") window.location.href = "/suspended";
  }

  return response;
}
