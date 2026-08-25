import Stripe from "stripe";
import { pool } from "@workspace/db";

interface PlanRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  monthly_price: string;
  annual_price: string;
}

async function main() {
  const secretKey = process.env["STRIPE_SECRET_KEY"];
  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY is required. Set it before running this script.\n" +
      "Example: STRIPE_SECRET_KEY=sk_test_... pnpm --filter @workspace/scripts tsx src/seed-stripe-plans.ts"
    );
  }

  const stripe = new Stripe(secretKey, {
    // Stripe v22 types only its newest API version; preserve the product's
    // explicitly pinned version until the Stripe integration is upgraded.
    // @ts-expect-error The pinned API version is intentionally older than the SDK union.
    apiVersion: "2025-08-27.basil",
  });

  const client = await pool.connect();
  let plans: PlanRow[];
  try {
    const result = await client.query<PlanRow>(
      "SELECT id, name, slug, description, monthly_price, annual_price FROM plans WHERE is_active = true AND payment_required = true ORDER BY sort_order"
    );
    plans = result.rows;
  } finally {
    client.release();
    await pool.end();
  }

  if (plans.length === 0) {
    console.log("No paid plans found in DB. Run seed-plans first.");
    return;
  }

  console.log(`Seeding ${plans.length} plans into Stripe...`);

  for (const plan of plans) {
    const productName = `VisiteCRM ${plan.name}`;
    const monthlyAmountCents = Math.round(Number(plan.monthly_price) * 100);
    const annualAmountCents = Math.round(Number(plan.annual_price) * 100);

    // Find or create product by metadata planSlug (idempotent)
    const existingProducts = await stripe.products.search({
      query: `metadata['planSlug']:'${plan.slug}' AND active:'true'`,
    });

    let product: Stripe.Product | undefined =
      existingProducts.data.length > 0 ? existingProducts.data[0]! : undefined;

    // Fallback: adopt a manually-created product matched by name when it lacks
    // planSlug metadata. The operator's LIVE products are plain "Pro"/"Enterprise"
    // with empty product-level metadata, so a metadata-only lookup misses them and
    // a naive create would produce duplicate "VisiteCRM Pro/Enterprise" products.
    // Matching by name lets the seeder adopt them and backfill the metadata instead.
    if (!product) {
      const allActive = await stripe.products.list({ active: true, limit: 100 });
      product = allActive.data.find(
        (p) => p.name === productName || p.name === plan.name
      );
      if (product) {
        console.log(`  Adopting existing product by name: "${product.name}" (${product.id})`);
      }
    }

    if (product) {
      console.log(`  Product exists: ${productName} (${product.id})`);
      // Update description and backfill planSlug/planId metadata (merging with any
      // existing metadata). Name is intentionally left untouched to avoid renaming
      // products an operator created and labelled manually.
      await stripe.products.update(product.id, {
        description: plan.description ?? undefined,
        metadata: { ...product.metadata, planSlug: plan.slug, planId: plan.id },
      });
    } else {
      product = await stripe.products.create({
        name: productName,
        description: plan.description ?? undefined,
        metadata: { planSlug: plan.slug, planId: plan.id },
      });
      console.log(`  Created product: ${productName} (${product.id})`);
    }

    // Monthly price — find by metadata planSlug + cycle
    const existingPrices = await stripe.prices.list({ product: product.id, active: true });

    const hasMonthly = existingPrices.data.some(
      (p) =>
        p.recurring?.interval === "month" &&
        p.unit_amount === monthlyAmountCents &&
        p.currency === "brl" &&
        p.metadata?.planSlug === plan.slug
    );
    if (!hasMonthly && monthlyAmountCents > 0) {
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: monthlyAmountCents,
        currency: "brl",
        recurring: { interval: "month" },
        metadata: { planSlug: plan.slug, planId: plan.id, cycle: "monthly" },
      });
      console.log(`    Created monthly price: R$${(monthlyAmountCents / 100).toFixed(2)}/mês (${price.id})`);
    } else if (hasMonthly) {
      console.log(`    Monthly price already exists.`);
    }

    const hasAnnual = existingPrices.data.some(
      (p) =>
        p.recurring?.interval === "year" &&
        p.unit_amount === annualAmountCents &&
        p.currency === "brl" &&
        p.metadata?.planSlug === plan.slug
    );
    if (!hasAnnual && annualAmountCents > 0) {
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: annualAmountCents,
        currency: "brl",
        recurring: { interval: "year" },
        metadata: { planSlug: plan.slug, planId: plan.id, cycle: "annual" },
      });
      console.log(`    Created annual price: R$${(annualAmountCents / 100).toFixed(2)}/ano (${price.id})`);
    } else if (hasAnnual) {
      console.log(`    Annual price already exists.`);
    }
  }

  console.log("\nDone! Stripe products and prices are ready.");
  console.log("Next steps:");
  console.log("  1. Create a webhook in Stripe Dashboard → Developers → Webhooks");
  console.log("     URL: https://<your-domain>/api/webhooks/stripe");
  console.log("     Events: checkout.session.completed, invoice.payment_succeeded,");
  console.log("             payment_intent.succeeded, payment_intent.payment_failed,");
  console.log("             customer.subscription.updated, customer.subscription.deleted");
  console.log("  2. Set STRIPE_WEBHOOK_SECRET in your environment secrets");
  console.log("  3. Set VITE_STRIPE_PUBLIC_KEY in your environment secrets (for frontend)");
}

main().catch((err) => {
  console.error("seed-stripe-plans failed:", err);
  process.exit(1);
});
