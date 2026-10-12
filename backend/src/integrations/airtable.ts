import { config } from "../config.js";
import { neutralizeFormulas } from "../lib/text.js";

const AIRTABLE_API = "https://api.airtable.com/v0";
const AIRTABLE_CONTENT_API = "https://content.airtable.com/v0";

// A hung Airtable request would otherwise hold a user request (or a whole sync
// run) open forever.
const REQUEST_TIMEOUT_MS = 15_000;

// Airtable allows ~5 requests/second per base and, once exceeded, rejects
// EVERYTHING for ~30 seconds. After a 429 we stop sending anything at all for
// that window: background syncs skip their runs (see airtableCoolingDown) and
// user-facing writes fail fast with a retryable error instead of piling on.
const COOLDOWN_MS = 30_000;
let cooldownUntil = 0;

// Proactive pacing: every request (all tables share one base) is spaced at least
// MIN_GAP_MS apart (~4.5/s, under the 5/s limit), so a burst queues for a moment
// instead of triggering the 429 + 30 s lockout. If the queue would make someone
// wait longer than MAX_QUEUE_WAIT_MS we fail fast with the same retryable error.
// In-memory, so it only holds for a single backend instance.
const MIN_GAP_MS = 220;
const MAX_QUEUE_WAIT_MS = 8_000;
let nextSlotAt = 0;

async function paced() {
  const now = Date.now();
  const at = Math.max(now, nextSlotAt);
  if (at - now > MAX_QUEUE_WAIT_MS) throw new AirtableRateLimitError();
  nextSlotAt = at + MIN_GAP_MS;
  if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
}

export class AirtableRateLimitError extends Error {
  constructor() {
    super("Airtable rate limit reached — backing off");
  }
}

// A response that says no (a 4xx other than 429, or a 5xx). 4xx = Airtable definitely did not
// do it; 5xx = unknown.
export class AirtableRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// The request may or may not have reached Airtable (timeout, dropped connection): it could
// STILL have created the record. Never assume "not created" for this.
export class AirtableAmbiguousError extends Error {}

// True only when we can be sure the write did not happen: it was never sent (rate-limit pause
// or full queue) or Airtable answered with a 4xx. A 408 is a timeout, which proves nothing.
export function isDefiniteFailure(err: unknown): boolean {
  if (err instanceof AirtableRateLimitError) return true;
  return err instanceof AirtableRequestError && err.status >= 400 && err.status < 500 && err.status !== 408;
}

// Status and Airtable's error type only: the body can echo values the user submitted.
function describeFailure(status: number, body: string): string {
  let type = "";
  try {
    const parsed = JSON.parse(body) as { error?: { type?: string } | string };
    type = typeof parsed.error === "string" ? parsed.error : (parsed.error?.type ?? "");
  } catch {
    // not JSON
  }
  return `${status} ${type}`.trim();
}

async function sendToAirtable(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new AirtableAmbiguousError(`Airtable request did not complete: ${err instanceof Error ? err.name : "error"}`);
  }
}

export function airtableCoolingDown(): boolean {
  return Date.now() < cooldownUntil;
}

async function airtableFetch(path: string, init: RequestInit) {
  if (airtableCoolingDown()) throw new AirtableRateLimitError();
  await paced();

  const response = await sendToAirtable(`${AIRTABLE_API}/${config.airtable.baseId}${path}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${config.airtable.pat}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (response.status === 429) {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    throw new AirtableRateLimitError();
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AirtableRequestError(`Airtable request failed: ${describeFailure(response.status, body)} `, response.status);
  }

  return response.json();
}

export async function createRecord(tableId: string, fields: Record<string, unknown>) {
  // Everything written here comes from users (submission and shipping forms): a leading =, +, - or @
  // would run as a formula when someone exports the table, so those get a leading apostrophe.
  const result = (await airtableFetch(`/${tableId}`, {
    method: "POST",
    body: JSON.stringify({ fields: neutralizeFormulas(fields) }),
  })) as { id: string };

  return result.id;
}

// File content only ever lives in request memory — never written to disk.
export async function uploadAttachment(
  tableId: string,
  recordId: string,
  fieldId: string,
  base64Content: string,
  contentType: string,
  filename: string,
) {
  if (airtableCoolingDown()) throw new AirtableRateLimitError();
  await paced();

  const response = await sendToAirtable(
    `${AIRTABLE_CONTENT_API}/${config.airtable.baseId}/${recordId}/${fieldId}/uploadAttachment`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.airtable.pat}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contentType,
        file: base64Content,
        filename,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  if (response.status === 429) {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    throw new AirtableRateLimitError();
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AirtableRequestError(`Airtable attachment upload failed: ${describeFailure(response.status, body)} `, response.status);
  }
}

// Used to clean up a half-made submission record (e.g. the screenshot upload failed).
export async function deleteRecord(tableId: string, recordId: string) {
  await airtableFetch(`/${tableId}/${recordId}`, { method: "DELETE" });
}

export async function getRecord(tableId: string, recordId: string) {
  return (await airtableFetch(`/${tableId}/${recordId}`, { method: "GET" })) as {
    id: string;
    fields: Record<string, unknown>;
  };
}

type AirtableRecord = { id: string; fields: Record<string, unknown> };

// Ids of the records matching a formula (read-only), following pagination to the end.
export async function findRecordsByFormula(tableId: string, filterByFormula: string): Promise<{ id: string; createdTime: string }[]> {
  const found: { id: string; createdTime: string }[] = [];
  let offset: string | undefined;
  do {
    const page = (await airtableFetch(`/${tableId}/listRecords`, {
      method: "POST",
      body: JSON.stringify({ filterByFormula, fields: ["notes"], pageSize: 100, ...(offset ? { offset } : {}) }),
    })) as { records: { id: string; createdTime?: string }[]; offset?: string };
    found.push(...page.records.map((record) => ({ id: record.id, createdTime: record.createdTime ?? "" })));
    offset = page.offset;
  } while (offset);
  return found;
}

export async function findRecordIdsByFormula(tableId: string, filterByFormula: string): Promise<string[]> {
  return (await findRecordsByFormula(tableId, filterByFormula)).map((record) => record.id);
}

// Fetches many records in as few requests as possible (one per 50 ids) instead
// of one request each — what keeps the sync well under Airtable's rate limit
// no matter how many submissions are waiting. POST (not GET) because 50 record
// ids in a query string would risk the URL length limit. Ids that no longer
// exist are simply absent from the result.
// `fields` limits what comes back: the submissions table holds addresses and birthdays, which a
// status check has no business downloading every few seconds.
export async function listRecordsByIds(tableId: string, ids: string[], fields?: string[]): Promise<AirtableRecord[]> {
  const found: AirtableRecord[] = [];

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const filterByFormula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
    let offset: string | undefined;

    do {
      const page = (await airtableFetch(`/${tableId}/listRecords`, {
        method: "POST",
        body: JSON.stringify({ filterByFormula, pageSize: 100, ...(fields ? { fields } : {}), ...(offset ? { offset } : {}) }),
      })) as { records: AirtableRecord[]; offset?: string };
      found.push(...page.records);
      offset = page.offset;
    } while (offset);
  }

  return found;
}

// Batched writes — Airtable accepts at most 10 records per create/update request.
export async function createRecords(tableId: string, rows: Record<string, unknown>[]): Promise<AirtableRecord[]> {
  const created: AirtableRecord[] = [];
  for (let i = 0; i < rows.length; i += 10) {
    const result = (await airtableFetch(`/${tableId}`, {
      method: "POST",
      body: JSON.stringify({ records: rows.slice(i, i + 10).map((fields) => ({ fields })) }),
    })) as { records: AirtableRecord[] };
    created.push(...result.records);
  }
  return created;
}

export async function updateRecords(
  tableId: string,
  rows: { id: string; fields: Record<string, unknown> }[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += 10) {
    await airtableFetch(`/${tableId}`, {
      method: "PATCH",
      body: JSON.stringify({ records: rows.slice(i, i + 10) }),
    });
  }
}

export async function listRecords(tableId: string) {
  const records: { id: string; createdTime?: string; fields: Record<string, unknown> }[] = [];
  let offset: string | undefined;

  do {
    const query = offset ? `?offset=${offset}` : "";
    const page = (await airtableFetch(`/${tableId}${query}`, { method: "GET" })) as {
      records: { id: string; createdTime?: string; fields: Record<string, unknown> }[];
      offset?: string;
    };
    records.push(...page.records);
    offset = page.offset;
  } while (offset);

  return records;
}
