import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Durable idempotency ledger for Stripe webhook events.
 *
 * Stripe guarantees at-least-once delivery: the same event id can arrive more
 * than once (retries, network races, multiple registered endpoints). To make
 * the webhook handler's side effects exactly-once we claim each event id here
 * BEFORE running any handler side effect, using an INSERT … ON CONFLICT DO
 * NOTHING RETURNING. Only the delivery whose insert wins the primary-key race
 * proceeds; concurrent/sequential duplicates find the row already claimed and
 * short-circuit with a 200 and no side effects.
 *
 * `status` tracks the claim lifecycle:
 *   - "processing" — claimed, handler side effects in flight.
 *   - "processed"  — handler finished successfully; the claim is permanent.
 * On handler failure the claim row is DELETED (released) so Stripe's automatic
 * retry can reprocess the event; failed events are never permanently suppressed.
 */
export const stripeWebhookEventsTable = pgTable("stripe_webhook_events", {
  id: text("id").primaryKey(),
  type: text("type"),
  status: text("status").notNull().default("processing"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

export type StripeWebhookEvent = typeof stripeWebhookEventsTable.$inferSelect;
