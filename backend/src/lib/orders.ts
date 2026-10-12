// Order bookkeeping for the shop's two-step purchase (see routes/shop.ts):
//   1. a short transaction takes the moles and records a "pending" order,
//   2. the fulfillment record is created in Airtable (no database connection held),
//   3. the order becomes "placed" -- or, if step 2 failed, "refunded".
// A crash between steps leaves a "pending" order; reconcilePendingOrders() settles it.

import { and, eq, lt } from "drizzle-orm";
import { db } from "../db/client.js";
import { orders, shopItems, transactions, users } from "../db/schema.js";
import { config } from "../config.js";
import { airtableCoolingDown, findRecordIdsByFormula } from "../integrations/airtable.js";
import { logAdminAction } from "./audit.js";

// Written to the fulfillment record's internal "notes" field so a record can be matched
// back to its order if the process died before the order was marked placed.
export const orderMarker = (orderId: string) => `Cubed order ${orderId}`;

const STALE_AFTER_MS = 3 * 60 * 1000;

// Gives the moles back for a still-pending order. Idempotent: only a pending order is
// refunded, and the status flip and the ledger entry happen in one transaction.
export async function refundPendingOrder(orderId: string, why: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .update(orders)
      .set({ status: "refunded" })
      .where(and(eq(orders.id, orderId), eq(orders.status, "pending")))
      .returning({ userId: orders.userId, pricePaid: orders.pricePaid, shopItemId: orders.shopItemId });
    if (!order) return false;

    const [item] = await tx.select({ name: shopItems.name }).from(shopItems).where(eq(shopItems.id, order.shopItemId));

    // The user row lock orders this against a concurrent purchase by the same person.
    const [lockedUser] = await tx.select({ balance: users.molesBalance }).from(users).where(eq(users.id, order.userId)).for("update");
    await tx.insert(transactions).values({
      userId: order.userId,
      type: "adjustment",
      amount: order.pricePaid,
      reason: `Refund: ${item?.name ?? "shop order"} (${why})`,
      refId: orderId,
    });
    await tx
      .update(users)
      .set({ molesBalance: lockedUser.balance + order.pricePaid })
      .where(eq(users.id, order.userId));
    return true;
  });
}

// Settles orders left "pending" (a crash or a failed final update). If a fulfillment record
// carrying the order's marker exists the order is placed; if Airtable answers and there is
// none, the moles are refunded. If Airtable can't be reached the order stays pending.
export async function reconcilePendingOrders(): Promise<void> {
  if (airtableCoolingDown()) return;

  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, "pending"), lt(orders.createdAt, new Date(Date.now() - STALE_AFTER_MS))))
    .limit(20);

  for (const { id } of stale) {
    let recordIds: string[];
    try {
      recordIds = await findRecordIdsByFormula(config.airtable.fulfillmentTableId, `FIND('${orderMarker(id)}', {notes}) > 0`);
    } catch (err) {
      // Unreachable or rate limited: try again next run. Logged so a permanent problem (for example a
      // renamed notes field) doesn't leave orders pending with no trace.
      console.warn(`Order reconciler could not look up order ${id}`, err instanceof Error ? err.message : err);
      return;
    }

    if (recordIds.length > 0) {
      await db.update(orders).set({ status: "placed", airtableRecordId: recordIds[0] }).where(and(eq(orders.id, id), eq(orders.status, "pending")));
    } else if (await refundPendingOrder(id, "fulfillment record was never created")) {
      await logAdminAction({ actorId: null, action: "order.refunded", targetType: "order", targetId: id, details: "stuck pending order refunded automatically" });
    }
  }
}
