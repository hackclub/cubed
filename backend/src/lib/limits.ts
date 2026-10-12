// Per-user abuse caps. Not security boundaries (nothing correctness-dependent
// relies on them) — they stop one account from piling up rows or CDN uploads.

// Drafts a person can have open at once. There is no cap on total projects: once they
// submit some, the slots free up.
export const MAX_DRAFTS_PER_USER = 6;

// Total submissions (attempts) per project, counting the first. A reviewer's
// "need changes" on the last allowed attempt becomes a final rejection.
export const MAX_SUBMISSION_ATTEMPTS = 3;

const PHOTO_UPLOADS_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

// In-memory, so correct for one backend instance only — same trade-off as
// middleware/rate-limit.ts. Entries are pruned on use.
const photoUploads = new Map<string, number[]>();

// Returns false (and records nothing) once a user has used up their hourly uploads.
export function takePhotoUploadSlot(userId: string): boolean {
  const now = Date.now();
  const recent = (photoUploads.get(userId) ?? []).filter((t) => now - t < HOUR_MS);
  if (recent.length >= PHOTO_UPLOADS_PER_HOUR) {
    photoUploads.set(userId, recent);
    return false;
  }
  recent.push(now);
  photoUploads.set(userId, recent);
  return true;
}
