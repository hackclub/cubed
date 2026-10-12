// Looks up a Slack avatar via Slack's Web API, since Hack Club Auth's own
// identity endpoint doesn't expose one. Requires the `users:read` bot scope.

import { config } from "../config.js";

// Slack's Web API almost always responds HTTP 200 even on failure — the
// real signal is the `ok` boolean in the body, checked explicitly below.
export async function fetchSlackAvatarUrl(slackId: string): Promise<string | null> {
  if (!config.slack.botToken) {
    return null;
  }

  try {
    const url = new URL("https://slack.com/api/users.info");
    url.searchParams.set("user", slackId);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.slack.botToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      ok: boolean;
      user?: { profile?: { image_192?: string } };
    };

    if (!data.ok) {
      return null;
    }

    return data.user?.profile?.image_192 ?? null;
  } catch {
    // A missing avatar is never worth failing a login over.
    return null;
  }
}
