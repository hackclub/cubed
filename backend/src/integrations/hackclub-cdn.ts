// Used only for project showcase photos — unrelated to the submission-time
// screenshot, which goes straight to Airtable instead. API reference:
// https://cdn.hackclub.com/docs/api (v4); key is HACKCLUB_CDN_API_KEY,
// optional at boot (see config.ts).

import { config } from "../config.js";

const CDN_API = "https://cdn.hackclub.com/api/v4";

// Trimmed to just the fields we use — see the API reference above for the full shape.
type CdnUploadResponse = {
  id: string;
  url: string;
};

type CdnErrorResponse = {
  code?: string;
  message?: string;
  error?: string;
};

// Extension is picked from the already-validated MIME type (see
// ALLOWED_IMAGE_TYPES in routes/projects.ts), not trusted from the filename.
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

// The CDN bakes the filename directly into the public URL it hands back,
// so this has to strip path components and unsafe characters, not just cosmetic.
// Also prefixed with "cubed-project-ss-" — Hack Club CDN is shared across YSWS
// programs, and this is what lets anyone tell which uploads came from Cubed
// once the program's over.
function sanitizeFilename(originalName: string, mimeType: string): string {
  const baseName = originalName.split(/[/\\]/).pop() ?? "photo";
  const stem =
    baseName
      .replace(/\.[^./\\]+$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .slice(0, 60) || "photo";

  const extension = EXTENSION_BY_MIME[mimeType] ?? "bin";
  return `cubed-project-ss-${stem}.${extension}`;
}

function requireApiKey(): string {
  if (!config.hackclubCdn.apiKey) {
    throw new Error("HACKCLUB_CDN_API_KEY is not configured");
  }
  return config.hackclubCdn.apiKey;
}

// Returns the public URL plus the CDN's own upload id (needed to delete it later).
export async function uploadProjectPhoto(file: File): Promise<{ url: string; cdnId: string }> {
  const apiKey = requireApiKey();
  const filename = sanitizeFilename(file.name, file.type);

  const form = new FormData();
  // Re-wrapped as a Blob under the sanitized filename — appending `file`
  // directly would send its original, unsanitized name.
  form.append("file", new Blob([await file.arrayBuffer()], { type: file.type }), filename);

  const response = await fetch(`${CDN_API}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });

  const body = (await response.json().catch(() => null)) as
    | CdnUploadResponse
    | CdnErrorResponse
    | null;

  if (!response.ok || !body || !("url" in body) || !("id" in body)) {
    const message = (body as CdnErrorResponse | null)?.message ?? `HTTP ${response.status}`;
    throw new Error(`Hack Club CDN upload failed: ${message}`);
  }

  return { url: body.url, cdnId: body.id };
}

// A 404 (already gone) is treated as success — the end state is what the caller wants either way.
export async function deleteProjectPhoto(cdnId: string): Promise<void> {
  const apiKey = requireApiKey();

  const response = await fetch(`${CDN_API}/upload/${cdnId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok && response.status !== 404) {
    const body = await response.text().catch(() => "");
    throw new Error(`Hack Club CDN delete failed: ${response.status} ${body}`);
  }
}
