// A brand-new person who hasn't verified their ID is asked their age BEFORE an
// account exists. Their identity (from Hack Club Auth) has to survive that one
// screen without being written anywhere on our side — so it rides in a
// short-lived, signed cookie on their own browser, and is only turned into an
// account if they answer "13-18". Answer "12 or under" / "19 or older" and the
// cookie is just thrown away: nothing about them was ever stored.
//
// Signed (HMAC-SHA256, keyed from COOKIE_SIGNING_SECRET with a fixed label) so it can't be forged or edited to create an account for
// someone else; 15 minutes to answer.

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";

export const SIGNUP_COOKIE_NAME = "cubed_signup";
// Set (browser-only, no server record) after a "12 or under" / "19 or older"
// answer, so the same browser can't instantly re-answer.
export const AGE_BLOCK_COOKIE_NAME = "cubed_age_block";
export const SIGNUP_TTL_MS = 15 * 60 * 1000;
export const AGE_BLOCK_TTL_S = 24 * 60 * 60;

const pendingSignupSchema = z.object({
  slackId: z.string().min(1),
  email: z.string().min(1),
  avatarUrl: z.string().nullable(),
  yswsStatus: z.enum(["needs_submission", "pending", "not_found"]),
  exp: z.number(),
});
export type PendingSignup = z.infer<typeof pendingSignupSchema>;

// Dedicated secret when set (required outside development); in development it falls
// back to a key derived from the OAuth client secret so a fresh checkout still runs.
const key = createHmac("sha256", config.cookieSigningSecret || config.hackclubAuth.clientSecret)
  .update("cubed-pending-signup-v1")
  .digest();

const sign = (payload: string) => createHmac("sha256", key).update(payload).digest("base64url");

export function signPendingSignup(data: Omit<PendingSignup, "exp">, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...data, exp: now + SIGNUP_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readPendingSignup(value: string | undefined, now = Date.now()): PendingSignup | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const parsed = pendingSignupSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (!parsed.success || parsed.data.exp < now) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
