import { db, plansTable } from "@workspace/db";
import { count } from "drizzle-orm";
import { logger } from "./logger";

// Canonical plan definitions. Kept in sync with scripts/src/seed-plans.ts.
// IMPORTANT: this startup seeder is INSERT-ONLY (onConflictDoNothing) so it can
// never overwrite plan rows an operator edited via the admin UI
// (POST/PATCH/DELETE /admin/plans). Use the standalone `seed:plans` script when
// you intentionally want to re-sync plan definitions (it uses ON CONFLICT DO UPDATE).
const PLAN_SEED = [
  {
    id: "plan_starter",
    name: "Starter",
    slug: "starter",
    description: "Para agências iniciantes",
    monthlyPrice: "0",
    annualPrice: "0",
    maxUsers: 3,
    maxClients: 500,
    maxTrips: 20,
    features: ["Até 3 usuários", "500 clientes", "20 viagens"],
    supportedFeatures: ["coupons"],
    isActive: true,
    isFeatured: false,
    sortOrder: 1,
    trialDays: 0,
    paymentRequired: false,
  },
  {
    id: "plan_pro",
    name: "Pro",
    slug: "pro",
    description: "Para agências em crescimento",
    monthlyPrice: "97",
    annualPrice: "970",
    maxUsers: 10,
    maxClients: 500,
    maxTrips: 100,
    features: ["Até 10 usuários", "500 clientes", "100 viagens", "Suporte prioritário"],
    supportedFeatures: ["referrals", "coupons", "seatMap"],
    isActive: true,
    isFeatured: true,
    sortOrder: 2,
    trialDays: 14,
    paymentRequired: true,
  },
  {
    id: "plan_enterprise",
    name: "Enterprise",
    slug: "enterprise",
    description: "Para grandes operadoras",
    monthlyPrice: "397",
    annualPrice: "3970",
    maxUsers: 50,
    maxClients: 5000,
    maxTrips: 500,
    features: ["Usuários ilimitados", "5000 clientes", "500 viagens", "Suporte dedicado"],
    supportedFeatures: ["referrals", "coupons", "seatMap"],
    isActive: true,
    isFeatured: false,
    sortOrder: 3,
    trialDays: 14,
    paymentRequired: true,
  },
];

/**
 * Idempotently ensures the canonical plan rows exist. Runs on server startup so
 * a freshly-deployed/empty production database does not leave billing,
 * onboarding, and plan selection broken (the /subscriptions/upgrade endpoint
 * 404s when no plan rows exist). Insert-only: existing rows are never modified.
 */
export async function seedPlansIfMissing(): Promise<void> {
  try {
    const [row] = await db.select({ cnt: count() }).from(plansTable);
    if ((row?.cnt ?? 0) > 0) {
      logger.debug({ count: row?.cnt }, "[seed-plans] plans already present — skipping startup seed");
      return;
    }

    await db.insert(plansTable).values(PLAN_SEED).onConflictDoNothing({ target: plansTable.slug });
    logger.info("[seed-plans] seeded canonical plans (Starter / Pro / Enterprise) into empty plans table");
  } catch (err) {
    // Non-fatal: a seeding failure must not block server boot.
    logger.error({ err }, "[seed-plans] failed to seed plans on startup");
  }
}
