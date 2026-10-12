// Browsing (GET /) and buying (POST /:id/buy — the only place moles get
// spent). Shipping info arrives with the purchase and is forwarded straight
// to Airtable, never persisted (PII, see CLAUDE.md rule 1).

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { orders, shopItems, transactions, users } from "../db/schema.js";
import { requireAuth, type SessionContext } from "../lib/session.js";
import { createRecord, isDefiniteFailure } from "../integrations/airtable.js";
import { checkEligibilityForGate } from "../lib/eligibility-check.js";
import { orderMarker, refundPendingOrder } from "../lib/orders.js";
import { config } from "../config.js";
import { text } from "../lib/text.js";

// Explicit allowlist, same reasoning as projectColumns in projects.ts.
const shopItemColumns = {
  id: shopItems.id,
  name: shopItems.name,
  description: shopItems.description,
  imageUrl: shopItems.imageUrl,
  category: shopItems.category,
  priceMoles: shopItems.priceMoles,
};

const orderColumns = {
  id: orders.id,
  quantity: orders.quantity,
  pricePaid: orders.pricePaid,
  createdAt: orders.createdAt,
};

// Quantity capped at 20 as defense-in-depth, not a real product constraint.
// Shipping info rides on the same request as the purchase on purpose: the
// order, the moles deduction, and the Airtable fulfillment record all
// succeed or fail together (see POST /:id/buy).
const buySchema = z.object({
  quantity: z.coerce.number().int().min(1).max(20).default(1),
  // Unicode letters/marks so José, O'Brien, Mary-Jane go through unchanged (shipping label name).
  fullName: z.string().trim().min(1).max(200).regex(/^[\p{L}\p{M} .'’-]+$/u, "Invalid characters in name"),
  addressLine1: text(1, 200),
  addressLine2: text(0, 200).optional(),
  city: text(1, 100),
  stateProvince: text(1, 100),
  country: text(1, 100),
  zip: text(1, 20),
  phone: text(1, 30),
  notes: text(0, 1000, true).optional(),
});

export const shopRoutes = new Hono<SessionContext>();

// No ownership filter — items aren't owned by a user. Only "active" ones show.
shopRoutes.get("/", async (c) => {
  const rows = await db.select(shopItemColumns).from(shopItems).where(eq(shopItems.active, true));
  return c.json(rows);
});

shopRoutes.get("/orders", requireAuth, async (c) => {
  const user = c.get("user")!;

  const rows = await db
    .select({ ...orderColumns, itemName: shopItems.name })
    .from(orders)
    .innerJoin(shopItems, eq(orders.shopItemId, shopItems.id))
    .where(and(eq(orders.userId, user.id), ne(orders.status, "refunded")))
    .orderBy(desc(orders.createdAt));

  return c.json(rows);
});


shopRoutes.post(
  "/:id/buy",
  requireAuth,
  // No file upload here (unlike the submission form) — 100KB is
  // defense-in-depth, not a real cap.
  bodyLimit({ maxSize: 100 * 1024 }),
  zValidator("json", buySchema),
  async (c) => {
    const user = c.get("user")!;
    const shopItemId = c.req.param("id");
    if (!shopItemId) {
      return c.json({ error: "not_found" }, 404);
    }

    // Live re-check, not just relying on the value from login — see the
    // identical check in routes/projects.ts's handleSubmission for why. Runs
    // before anything is charged or recorded, so a banned user never gets
    // an order or an Airtable record.
    const verdict = await checkEligibilityForGate(user);
  if (verdict) {
    return c.json(verdict.body, verdict.status);
  }

    const { quantity, ...shipping } = c.req.valid("json");

    // Step 1 -- a SHORT transaction (no network inside it): lock the user, check the balance,
    // record a pending order, take the moles. The row lock makes two concurrent buys by the
    // same person wait for each other, so they can't both spend the same moles.
    const reserved = await db.transaction(async (tx) => {
      const [lockedUser] = await tx
        .select({ id: users.id, molesBalance: users.molesBalance })
        .from(users)
        .where(eq(users.id, user.id))
        .for("update");

      const [item] = await tx
        .select({ id: shopItems.id, name: shopItems.name, priceMoles: shopItems.priceMoles })
        .from(shopItems)
        // Re-checked here too -- admin could deactivate the item between page load
        // and click. The price check is a backstop against a free/negative-priced item.
        .where(and(eq(shopItems.id, shopItemId), eq(shopItems.active, true), gt(shopItems.priceMoles, 0)));

      if (!item) {
        return { error: "not_found" as const };
      }

      const totalPrice = item.priceMoles * quantity;

      if (lockedUser.molesBalance < totalPrice) {
        return { error: "insufficient_balance" as const };
      }

      const [order] = await tx
        .insert(orders)
        .values({
          userId: user.id,
          shopItemId: item.id,
          quantity,
          // Snapshots the TOTAL price paid, so a later Airtable price change
          // doesn't rewrite this order's history.
          pricePaid: totalPrice,
          status: "pending",
        })
        .returning(orderColumns);

      // reason is human-readable (shown in the ledger UI); refId carries the
      // real order id for anything that needs to look it up programmatically.
      await tx.insert(transactions).values({
        userId: user.id,
        type: "spent",
        amount: totalPrice,
        reason: quantity > 1 ? `Bought ${quantity}× ${item.name}` : `Bought ${item.name}`,
        refId: order.id,
      });

      await tx
        .update(users)
        .set({ molesBalance: lockedUser.molesBalance - totalPrice })
        .where(eq(users.id, user.id));

      return { order, itemName: item.name, totalPrice };
    });

    if ("error" in reserved) {
      return c.json({ error: reserved.error }, reserved.error === "not_found" ? 404 : 409);
    }

    // Step 2 -- the Airtable fulfillment record, with no database connection or lock held.
    // Field names below match the real "fulfilment" table (one L) built by hand in Airtable:
    //  - both a combined "address" field and separate Address Line 1/2/city/etc. fields exist --
    //    we write both, the combined one purely so the admin can see a whole address at a glance.
    //  - both a "Fullfiled?" checkbox and a "fulfillment status" select exist -- we only set the select.
    //  - never persisted in Postgres -- the whole point of this flow.
    let fulfillmentRecordId: string;
    try {
      fulfillmentRecordId = await createRecord(config.airtable.fulfillmentTableId, {
        // No "Order ID" field on the real table (confirmed via metadata API) -- sending one made
        // every purchase fail with an unknown-field error. The order id rides in the internal
        // "notes" field instead, so a crashed purchase can be matched back (lib/orders.ts).
        notes: orderMarker(reserved.order.id),
        item_name: quantity > 1 ? `${quantity}x ${reserved.itemName}` : reserved.itemName,
        "Full Name": shipping.fullName,
        // Account email, not client input -- the whole point is that this can't be typo'd/spoofed.
        Email: user.email,
        slack_id: user.slackId,
        currency_spent: "moles",
        amount: reserved.totalPrice,
        "Address Line 1": shipping.addressLine1,
        "Address Line 2": shipping.addressLine2 ?? "",
        city: shipping.city,
        "State/Province": shipping.stateProvince,
        Country: shipping.country,
        "Postal/ZIP Code": shipping.zip,
        address: [
          shipping.addressLine1,
          shipping.addressLine2,
          shipping.city,
          shipping.stateProvince,
          shipping.zip,
          shipping.country,
        ]
          .filter(Boolean)
          .join(", "),
        phone_number: shipping.phone,
        // Real options are ordered/not fulfilled/delivered/issue, NOT "pending" -- Airtable
        // rejects unrecognized select values outright (422).
        "fulfillment status": "not fulfilled",
        // Distinct from the internal "notes" field -- this is what the buyer typed.
        "user order notes": shipping.notes ?? "",
      });
    } catch (err) {
      console.error("Airtable fulfillment failed", err instanceof Error ? err.message : err);
      // A timeout or a 5xx does NOT prove the record wasn't created (it may still have landed, and
      // then the prize ships). Leave the order pending: the reconciler (lib/orders.ts) finds the
      // record by its marker and places the order, or refunds if there is none.
      if (!isDefiniteFailure(err)) {
        return c.json({ error: "fulfillment_unconfirmed" }, 502);
      }
      // Definitely not created (never sent, or Airtable said no): give the moles back right away.
      // If even that fails, the order stays pending and the reconciler settles it shortly.
      await refundPendingOrder(reserved.order.id, "fulfillment record could not be created").catch((refundErr) => {
        console.error("Refund failed, left for the reconciler", refundErr instanceof Error ? refundErr.message : refundErr);
      });
      return c.json({ error: "fulfillment_failed" }, 502);
    }

    // Step 3 -- confirm. If this single update fails the order stays pending and the
    // reconciler finds the fulfillment record by its marker and marks it placed.
    await db
      .update(orders)
      .set({ status: "placed", airtableRecordId: fulfillmentRecordId })
      .where(and(eq(orders.id, reserved.order.id), eq(orders.status, "pending")))
      .catch((err) => console.error("Could not mark order placed", err instanceof Error ? err.message : err));

    return c.json({ ...reserved.order, itemName: reserved.itemName }, 201);
  },
);
