// Keeps the Airtable "Loops" table, the newsletter audience that Hack Club's Loops sync reads,
// in step with Cubed: one row per account, every account (nobody opts in by design; they can
// unsubscribe from the email itself). Cubed owns every column; the table is not edited by hand.
//
// Only an email and activity timestamps go there, no names or addresses. The timestamp fields
// become Loops contact attributes, so their names must match Hack Club's convention
// `Loops - <programSlug>SignUpAt` once the slug is known (LOOPS_PROGRAM_SLUG); until then plain
// names are used, which the Loops sync ignores.

import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { airtableCoolingDown, createRecords, listRecords, updateRecords } from "../integrations/airtable.js";
import { config } from "../config.js";
import { runExclusive } from "../lib/exclusive.js";

const MILESTONES = ["signUp", "onboarded", "createdProject", "submittedProject", "approvedProject", "firstOrder", "lastLogin"] as const;
type Milestone = (typeof MILESTONES)[number];

const PLAIN_NAMES: Record<Milestone, string> = {
  signUp: "Signed Up At",
  onboarded: "Onboarded At",
  createdProject: "Created Project At",
  submittedProject: "Submitted Project At",
  approvedProject: "Approved Project At",
  firstOrder: "First Order At",
  lastLogin: "Last Login At",
};

const SLUG_SUFFIX: Record<Milestone, string> = {
  signUp: "SignUpAt",
  onboarded: "OnboardedAt",
  createdProject: "CreatedProjectAt",
  submittedProject: "SubmittedProjectAt",
  approvedProject: "ApprovedProjectAt",
  firstOrder: "FirstOrderAt",
  lastLogin: "LastLoginAt",
};

export function loopsFieldName(milestone: Milestone, slug = config.loops.programSlug): string {
  return slug ? `Loops - ${slug}${SLUG_SUFFIX[milestone]}` : PLAIN_NAMES[milestone];
}

const text = (value: unknown) => (value == null ? "" : String(value).trim());
const emailKey = (value: unknown) => text(value).toLowerCase();
// Whole seconds, so Airtable's ".000Z" form and ours compare equal.
const seconds = (value: unknown) => {
  const ms = value ? Date.parse(String(value)) : NaN;
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
};

type Row = {
  id: string;
  email: string;
  signed_up: Date;
  onboarded: Date | null;
  last_seen: Date | null;
  first_project: Date | null;
  first_submitted: Date | null;
  first_approved: Date | null;
  first_order: Date | null;
};

// Raw SQL hands timestamps back as strings, so they are turned into Dates here.
const asDate = (value: unknown) => (value == null ? null : new Date(value as string | Date));

async function loadAccounts(): Promise<Row[]> {
  const rows = (await db.execute(sql`
    select
      u.id,
      u.email,
      u.created_at as signed_up,
      u.onboarded_at as onboarded,
      u.last_seen_at as last_seen,
      (select min(p.created_at) from projects p where p.user_id = u.id) as first_project,
      (select min(s.submitted_at) from submissions s join projects p on p.id = s.project_id where p.user_id = u.id) as first_submitted,
      (select min(s.synced_at) from submissions s join projects p on p.id = s.project_id where p.user_id = u.id and s.status = 'accepted') as first_approved,
      (select min(o.created_at) from orders o where o.user_id = u.id and o.status = 'placed') as first_order
    from ${users} u
    where u.email <> ''
  `)) as unknown as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    signed_up: asDate(row.signed_up)!,
    onboarded: asDate(row.onboarded),
    last_seen: asDate(row.last_seen),
    first_project: asDate(row.first_project),
    first_submitted: asDate(row.first_submitted),
    first_approved: asDate(row.first_approved),
    first_order: asDate(row.first_order),
  }));
}

function desiredFields(account: Row): Record<string, string | null> {
  const lastSeen = account.last_seen;
  const day = lastSeen ? new Date(Date.UTC(lastSeen.getUTCFullYear(), lastSeen.getUTCMonth(), lastSeen.getUTCDate())) : null;
  const value = (date: Date | null) => (date ? date.toISOString() : null);
  return {
    Email: account.email,
    "Cubed User ID": account.id,
    [loopsFieldName("signUp")]: value(account.signed_up),
    [loopsFieldName("onboarded")]: value(account.onboarded),
    [loopsFieldName("createdProject")]: value(account.first_project),
    [loopsFieldName("submittedProject")]: value(account.first_submitted),
    [loopsFieldName("approvedProject")]: value(account.first_approved),
    [loopsFieldName("firstOrder")]: value(account.first_order),
    // Day precision: a person who is active all day costs one write, not hundreds.
    [loopsFieldName("lastLogin")]: value(day),
  };
}

function differs(field: string, current: unknown, wanted: string | null): boolean {
  if (field === "Email") return emailKey(current) !== emailKey(wanted);
  if (field === "Cubed User ID") return text(current) !== text(wanted);
  return seconds(current) !== (wanted ? seconds(wanted) : null);
}

export async function syncLoopsTable() {
  const tableId = config.loops.tableId;
  if (!tableId) return;

  // Read first: if this throws nothing below runs.
  const records = await listRecords(tableId);
  records.sort((a, b) => (a.createdTime ?? "").localeCompare(b.createdTime ?? ""));

  const byUserId = new Map<string, (typeof records)[number]>();
  const byEmail = new Map<string, (typeof records)[number]>();
  for (const record of records) {
    const id = text(record.fields["Cubed User ID"]);
    const email = emailKey(record.fields.Email);
    // The oldest row wins, so the choice is stable if a duplicate ever appears.
    if (id && !byUserId.has(id)) byUserId.set(id, record);
    if (email && !byEmail.has(email)) byEmail.set(email, record);
  }

  const toCreate: Record<string, unknown>[] = [];
  const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];

  for (const account of await loadAccounts()) {
    const wanted = desiredFields(account);
    // A hand-made row for the same address is adopted instead of duplicated.
    const record = byUserId.get(account.id) ?? byEmail.get(emailKey(account.email));
    if (!record) {
      // Airtable rejects a null date on create; leave empty ones out.
      toCreate.push(Object.fromEntries(Object.entries(wanted).filter(([, value]) => value !== null)));
      continue;
    }
    const changed: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(wanted)) {
      if (differs(field, record.fields[field], value)) changed[field] = value;
    }
    if (Object.keys(changed).length > 0) toUpdate.push({ id: record.id, fields: changed });
  }

  if (toCreate.length > 0) {
    // Re-read right before creating: a row added since the read above must not become a duplicate.
    const fresh = await listRecords(tableId);
    const known = new Set(fresh.flatMap((r) => [text(r.fields["Cubed User ID"]), emailKey(r.fields.Email)]).filter(Boolean));
    const reallyNew = toCreate.filter((row) => !known.has(text(row["Cubed User ID"])) && !known.has(emailKey(row.Email)));
    if (reallyNew.length > 0) await createRecords(tableId, reallyNew);
  }
  if (toUpdate.length > 0) await updateRecords(tableId, toUpdate);
}

export async function runLoopsSync() {
  return runExclusive("loops-sync", syncLoopsTable);
}

export function scheduleLoopsSync() {
  if (!config.loops.tableId) return;

  setInterval(() => {
    if (airtableCoolingDown()) return;
    runLoopsSync().catch((err) => {
      console.error("Loops sync failed", err instanceof Error ? err.message : err);
    });
  }, config.loops.syncIntervalSeconds * 1000);
}
