/**
 * Stripe price health-check cron.
 *
 * Runs daily and sends one alert email per calendar day (Brazil time) when any
 * non-free plan is missing a matching active monthly or annual Stripe price.
 *
 * ── Deduplication: atomic, cross-instance, restart-safe ──────────────────────
 *
 * Uses a single-statement conditional upsert:
 *
 *   INSERT INTO platform_settings (id, key, value, …)
 *   VALUES (…, DEDUP_KEY, '{today}:{token}', …)
 *   ON CONFLICT (key) DO UPDATE
 *     SET value = EXCLUDED.value, updated_at = now()
 *     WHERE platform_settings.value NOT LIKE '{today}:%'
 *   RETURNING value
 *
 * PostgreSQL serialises concurrent inserts on the unique key.  The first
 * instance wins — its INSERT succeeds and RETURNING carries the row.  Any
 * concurrent attempt that conflicts either sees the winner's today-prefixed
 * value (WHERE is false → DO UPDATE is skipped → RETURNING is empty) or, if
 * no row existed yet, blocks at the INSERT until the winner commits, then
 * sees the winner's value in its conflict check and also gets RETURNING empty.
 *
 * The claimed value is `{today}:{token}` where token is a per-invocation
 * UUID.  Release checks `WHERE value = {today}:{token}` so only the owner
 * can restore the pre-claim state — a late-failing sender cannot reopen a
 * slot that another instance has already successfully used.
 *
 * On a failed send, the owner restores the previous DB value (or deletes the
 * row when it was newly created) so the next cron run can retry delivery.
 */

import { db, plansTable, platformSettingsTable, tenantsTable } from "@workspace/db";
import { asc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { getStripeSecretKey } from "./stripeClient";
import { logger } from "./logger";
import { generateId } from "./id";
import { dispatchOutboundMessage } from "../services/outbound-delivery";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEDUP_KEY = "stripe_health_alert_last_sent";
/**
 * Tracks whether the last successfully delivered alert still has an open
 * recovery event.  Keeping this separate from the daily alert slot means the
 * alert can retain its existing once-per-day semantics while recovery is
 * sent exactly once per outage.
 */
const UNHEALTHY_STATE_KEY = "stripe_health_was_unhealthy";
const UNHEALTHY_STATE_VALUE = "unhealthy";
const RECOVERY_CLAIM_PREFIX = "recovery:";
/** Separator between the date part and the per-claim ownership token. */
const SEP = ":";

// ─── Date helper ──────────────────────────────────────────────────────────────

function brazilDateString(): string {
  // "sv-SE" locale produces ISO 8601 date — convenient YYYY-MM-DD output.
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

// ─── Alert recipient ──────────────────────────────────────────────────────────
// Reads platform_settings key `stripe_health_alert_email` first; falls back
// to the SUPERADMIN_EMAIL env var.  DB errors fall back silently so a secondary
// outage never blocks alert delivery.
async function getAlertEmail(): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "stripe_health_alert_email"))
      .limit(1);
    if (row?.value?.trim()) return row.value.trim();
  } catch {
    // fall through
  }
  return process.env["SUPERADMIN_EMAIL"]?.trim() ?? null;
}

async function getAlertTenantId(): Promise<string | null> {
  const [tenant] = await db.select({ id: tenantsTable.id }).from(tenantsTable).limit(1);
  return tenant?.id ?? null;
}

function healthRecoveryHtml(dashboardUrl: string | null): string {
  return `<h2>✅ Preços Stripe restaurados</h2><p>O monitoramento diário confirmou que todos os planos pagos possuem novamente os preços Stripe mensais e anuais esperados.</p><p>O problema informado no alerta anterior foi resolvido e os clientes podem voltar a assinar os planos normalmente.</p>${dashboardUrl ? `<p><a href="${dashboardUrl}">Ver planos no painel de administração</a></p>` : ""}`;
}

function healthAlertHtml(
  missingPlans: Array<{ name: string; slug: string; monthlyOk: boolean; annualOk: boolean }>,
  dashboardUrl: string | null,
): string {
  const rows = missingPlans.map((plan) => {
    const missing = [!plan.monthlyOk ? "mensal" : "", !plan.annualOk ? "anual" : ""].filter(Boolean).join(", ");
    return `<tr><td>${plan.name} (<code>${plan.slug}</code>)</td><td>${missing} ausente</td></tr>`;
  }).join("");
  return `<h2>⚠️ Alerta: Preços Stripe ausentes</h2><p>O monitoramento diário detectou <strong>${missingPlans.length} plano(s)</strong> sem um preço Stripe correspondente.</p><table><thead><tr><th>Plano</th><th>Problema</th></tr></thead><tbody>${rows}</tbody></table><p>Acesse o painel de administração → Planos para verificar e corrigir o mapeamento de preços no Stripe.</p>${dashboardUrl ? `<p><a href="${dashboardUrl}">Ver planos no painel de administração</a></p>` : ""}`;
}

// ─── Atomic slot claim ────────────────────────────────────────────────────────

interface ClaimResult {
  /** True when this invocation won the race and may send the email. */
  claimed: boolean;
  /** Ownership token embedded in the DB value — needed to release the slot. */
  claimToken: string;
  /** Value that was in the row before this invocation (null if absent). */
  previousValue: string | null;
  /** Whether the dedup row existed before this invocation. */
  rowExisted: boolean;
}

/**
 * Atomically tries to claim the "send slot" for today's Brazil date.
 *
 * Uses a single INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING statement.
 * PostgreSQL serialises concurrent INSERTs on the unique key — only the winner
 * gets a RETURNING row; all other instances get an empty result.
 */
async function tryClaimAlertSlot(today: string): Promise<ClaimResult> {
  const claimToken = randomUUID();
  const claimValue = `${today}${SEP}${claimToken}`;
  // Pattern that matches any claim from today — used in the WHERE guard.
  const todayPattern = `${today}${SEP}%`;

  // Read the pre-claim value so we can restore it on failure.
  // This non-transactional read is safe: if another instance wins between
  // here and the INSERT we will not get RETURNING rows and therefore will
  // never call release — previousValue is only used by the winner.
  const before = await db
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, DEDUP_KEY))
    .limit(1);
  const previousValue = before[0]?.value ?? null;
  const rowExisted = before.length > 0;

  const raw = await db.execute(sql`
    INSERT INTO platform_settings (id, key, value, label, description, type)
    VALUES (
      ${generateId()},
      ${DEDUP_KEY},
      ${claimValue},
      ${"Último envio do alerta de saúde Stripe"},
      ${"Data e token (YYYY-MM-DD:uuid, horário de Brasília) do último e-mail de alerta de preços Stripe ausentes enviado pelo cron."},
      ${"string"}
    )
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = now()
      WHERE platform_settings.value NOT LIKE ${todayPattern}
    RETURNING value
  `);

  const rows = (raw as unknown as { rows: Array<{ value: string }> }).rows;
  const claimed = rows.length > 0;

  return { claimed, claimToken, previousValue, rowExisted };
}

/**
 * Releases the slot claimed by this invocation — but ONLY if the DB value
 * still matches our ownership token.  A late-running release cannot
 * accidentally reopen a slot that another instance has already successfully
 * used.
 */
async function releaseAlertSlot(
  today: string,
  claimToken: string,
  previousValue: string | null,
  rowExisted: boolean,
): Promise<void> {
  const claimValue = `${today}${SEP}${claimToken}`;
  try {
    if (!rowExisted) {
      // Row was created by this invocation — delete it, but only if we still own it.
      await db.execute(sql`
        DELETE FROM platform_settings
        WHERE key = ${DEDUP_KEY}
          AND value = ${claimValue}
      `);
    } else {
      // Restore the previous value, but only if we still own the row.
      await db.execute(sql`
        UPDATE platform_settings
        SET value      = ${previousValue},
            updated_at = now()
        WHERE key   = ${DEDUP_KEY}
          AND value = ${claimValue}
      `);
    }
  } catch (err) {
    logger.error(
      { err, claimToken, previousValue, rowExisted },
      "[stripe-health] Failed to release alert slot after send failure — next run may skip incorrectly if this error persists",
    );
  }
}

// ─── Recovery state ───────────────────────────────────────────────────────────

interface RecoveryClaimResult {
  /** True when this invocation won the recovery race and may send the email. */
  claimed: boolean;
  /** Ownership token used to finalize or release the claim safely. */
  claimToken: string;
}

/**
 * Records that an alert was successfully delivered and that a future healthy
 * check should notify the recipient when the incident is resolved.
 *
 * An upsert also repairs the marker if a previous recovery claim overlaps a
 * newly detected outage.  The recovery finalizer checks its ownership token,
 * so it cannot clear this newer unhealthy state.
 */
async function markStripeHealthUnhealthy(): Promise<void> {
  await db.execute(sql`
    INSERT INTO platform_settings (id, key, value, label, description, type)
    VALUES (
      ${generateId()},
      ${UNHEALTHY_STATE_KEY},
      ${UNHEALTHY_STATE_VALUE},
      ${"Estado do alerta de saúde Stripe"},
      ${"Indica que um alerta de preços Stripe foi enviado e aguarda notificação de recuperação."},
      ${"string"}
    )
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = now()
  `);
}

/**
 * Atomically claims the pending recovery event.  Only one instance can
 * transition the marker from `unhealthy` to its own recovery token.
 */
async function tryClaimRecoverySlot(): Promise<RecoveryClaimResult> {
  const claimToken = randomUUID();
  const claimValue = `${RECOVERY_CLAIM_PREFIX}${claimToken}`;
  const raw = await db.execute(sql`
    UPDATE platform_settings
    SET value = ${claimValue},
        updated_at = now()
    WHERE key = ${UNHEALTHY_STATE_KEY}
      AND value = ${UNHEALTHY_STATE_VALUE}
    RETURNING value
  `);

  const rows = (raw as unknown as { rows: Array<{ value: string }> }).rows;
  return { claimed: rows.length > 0, claimToken };
}

/**
 * Restores a failed recovery claim.  A concurrent unhealthy check may have
 * replaced the claim with a new `unhealthy` state, in which case no write is
 * needed.
 */
async function releaseRecoverySlot(claimToken: string): Promise<void> {
  const claimValue = `${RECOVERY_CLAIM_PREFIX}${claimToken}`;
  try {
    await db.execute(sql`
      UPDATE platform_settings
      SET value = ${UNHEALTHY_STATE_VALUE},
          updated_at = now()
      WHERE key = ${UNHEALTHY_STATE_KEY}
        AND value = ${claimValue}
    `);
  } catch (err) {
    logger.error(
      { err, claimToken },
      "[stripe-health] Failed to release recovery slot after send failure — next run may skip incorrectly if this error persists",
    );
  }
}

/**
 * Finalizes a successful recovery only when this invocation still owns the
 * claim.  This prevents an overlapping new outage from being erased.
 */
async function completeRecoverySlot(claimToken: string): Promise<void> {
  const claimValue = `${RECOVERY_CLAIM_PREFIX}${claimToken}`;
  try {
    await db.execute(sql`
      DELETE FROM platform_settings
      WHERE key = ${UNHEALTHY_STATE_KEY}
        AND value = ${claimValue}
    `);
  } catch (err) {
    logger.error(
      { err, claimToken },
      "[stripe-health] Failed to clear Stripe recovery state after successful email",
    );
  }
}

// ─── Core health-check logic (mirrors /admin/plans/stripe-health route) ───────

interface PlanHealthResult {
  planId: string;
  slug: string;
  name: string;
  isActive: boolean | null;
  monthlyOk: boolean;
  annualOk: boolean;
  isFree: boolean;
  error?: string;
}

async function checkStripeHealth(stripe: Stripe): Promise<PlanHealthResult[]> {
  const plans = await db
    .select()
    .from(plansTable)
    .orderBy(asc(plansTable.sortOrder), asc(plansTable.createdAt));

  return Promise.all(
    plans.map(async (plan): Promise<PlanHealthResult> => {
      const monthlyPriceCents = Math.round(Number(plan.monthlyPrice) * 100);
      const annualPriceCents = Math.round(Number(plan.annualPrice) * 100);

      const needsMonthly = monthlyPriceCents > 0;
      const needsAnnual = annualPriceCents > 0;

      if (!needsMonthly && !needsAnnual) {
        return {
          planId: plan.id,
          slug: plan.slug,
          name: plan.name,
          isActive: plan.isActive,
          monthlyOk: true,
          annualOk: true,
          isFree: true,
        };
      }

      let stripePrices: Stripe.Price[] = [];
      try {
        const result = await stripe.prices.search({
          query: `metadata['planSlug']:'${plan.slug}' AND active:'true'`,
          limit: 20,
        });
        stripePrices = result.data;
      } catch {
        return {
          planId: plan.id,
          slug: plan.slug,
          name: plan.name,
          isActive: plan.isActive,
          monthlyOk: false,
          annualOk: false,
          isFree: false,
          error: "Falha ao consultar preços no Stripe",
        };
      }

      const monthlyOk =
        !needsMonthly ||
        stripePrices.some(
          (p) =>
            p.recurring?.interval === "month" &&
            p.unit_amount === monthlyPriceCents &&
            p.currency === "brl",
        );
      const annualOk =
        !needsAnnual ||
        stripePrices.some(
          (p) =>
            p.recurring?.interval === "year" &&
            p.unit_amount === annualPriceCents &&
            p.currency === "brl",
        );

      return {
        planId: plan.id,
        slug: plan.slug,
        name: plan.name,
        isActive: plan.isActive,
        monthlyOk,
        annualOk,
        isFree: false,
      };
    }),
  );
}

// ─── Exported cron handler ────────────────────────────────────────────────────

export async function runStripeHealthCheckCron(): Promise<void> {
  const secretKey = await getStripeSecretKey();
  if (!secretKey) {
    logger.info("[stripe-health] Stripe not configured — skipping health check");
    return;
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion,
  });

  let results: PlanHealthResult[];
  try {
    results = await checkStripeHealth(stripe);
  } catch (err) {
    logger.error({ err }, "[stripe-health] Failed to check Stripe prices — aborting cron");
    return;
  }

  const unhealthy = results.filter((r) => !r.isFree && (!r.monthlyOk || !r.annualOk));

  if (unhealthy.length === 0) {
    let recoveryClaim: RecoveryClaimResult;
    try {
      recoveryClaim = await tryClaimRecoverySlot();
    } catch (err) {
      logger.error(
        { err },
        "[stripe-health] Failed to acquire recovery slot from DB — skipping recovery email",
      );
      return;
    }

    if (recoveryClaim.claimed) {
      const alertEmail = await getAlertEmail();
      if (!alertEmail) {
        await releaseRecoverySlot(recoveryClaim.claimToken);
        logger.warn(
          "[stripe-health] No alert email configured for Stripe recovery (set stripe_health_alert_email in platform settings or SUPERADMIN_EMAIL env) — recovery slot released",
        );
        return;
      }

      const appUrl = (process.env["APP_URL"] ?? "").trim().replace(/\/$/, "");
      const dashboardUrl = appUrl ? `${appUrl}/admin/plans` : null;
      const tenantId = await getAlertTenantId();
      if (!tenantId) {
        await releaseRecoverySlot(recoveryClaim.claimToken);
        logger.warn("[stripe-health] No tenant available for recovery alert — recovery slot released");
        return;
      }
      let outbound: Awaited<ReturnType<typeof dispatchOutboundMessage>>;
      try {
        outbound = await dispatchOutboundMessage({
          tenantId,
          eventType: "stripe_health_recovery",
          idempotencyKey: `stripe-health-recovery:${brazilDateString()}`,
          recipient: { type: "direct", email: alertEmail },
          email: {
            subject: "[VisiteCRM] Preços Stripe restaurados — sistema normalizado",
            html: healthRecoveryHtml(dashboardUrl),
            senderName: "VisiteCRM",
          },
          whatsapp: {
            text: `VisiteCRM: os preços Stripe foram restaurados e o sistema está normalizado.${dashboardUrl ? ` Painel: ${dashboardUrl}` : ""}`,
          },
          origin: "stripe-health-recovery",
          metadata: { dashboardUrl },
        });
      } catch (err) {
        await releaseRecoverySlot(recoveryClaim.claimToken);
        logger.error({ err }, "[stripe-health] Failed to dispatch recovery email — slot released");
        return;
      }
      const recoveryDelivery = outbound.deliveries.find((item) => item.channel === "email");
      const emailResult = {
        success: recoveryDelivery?.status === "accepted" || recoveryDelivery?.status === "pending",
        error: recoveryDelivery?.lastError ?? recoveryDelivery?.skippedReason,
      };

      if (emailResult.success) {
        await completeRecoverySlot(recoveryClaim.claimToken);
        logger.info(
          { to: alertEmail },
          "[stripe-health] Recovery email sent — Stripe prices restored",
        );
      } else {
        await releaseRecoverySlot(recoveryClaim.claimToken);
        logger.error(
          { error: emailResult.error },
          "[stripe-health] Failed to send recovery email — slot released, will retry on next cron run",
        );
      }
    }

    logger.info(
      "[stripe-health] All non-free plans have matching Stripe prices — no alert needed",
    );
    return;
  }

  // ── Atomic cross-instance slot claim ──
  const today = brazilDateString();
  let claim: ClaimResult;
  try {
    claim = await tryClaimAlertSlot(today);
  } catch (err) {
    logger.error(
      { err },
      "[stripe-health] Failed to acquire alert slot from DB — skipping to avoid duplicate sends",
    );
    return;
  }

  if (!claim.claimed) {
    logger.info(
      { date: today, unhealthyCount: unhealthy.length },
      "[stripe-health] Alert already claimed for today by another instance — skipping",
    );
    return;
  }

  // We hold the slot. Resolve recipient.
  const alertEmail = await getAlertEmail();
  if (!alertEmail) {
    await releaseAlertSlot(today, claim.claimToken, claim.previousValue, claim.rowExisted);
    logger.warn(
      "[stripe-health] No alert email configured (set stripe_health_alert_email in platform settings or SUPERADMIN_EMAIL env) — slot released",
    );
    return;
  }

  const appUrl = (process.env["APP_URL"] ?? "").trim().replace(/\/$/, "");
  const dashboardUrl = appUrl ? `${appUrl}/admin/plans` : null;

  const tenantId = await getAlertTenantId();
  if (!tenantId) {
    await releaseAlertSlot(today, claim.claimToken, claim.previousValue, claim.rowExisted);
    logger.warn("[stripe-health] No tenant available for Stripe health alert — slot released");
    return;
  }
  const missingPlans = unhealthy.map((r) => ({
    name: r.name,
    slug: r.slug,
    monthlyOk: r.monthlyOk,
    annualOk: r.annualOk,
  }));
  let outbound: Awaited<ReturnType<typeof dispatchOutboundMessage>>;
  try {
    outbound = await dispatchOutboundMessage({
      tenantId,
      eventType: "stripe_health_alert",
      idempotencyKey: `stripe-health-alert:${today}`,
      recipient: { type: "direct", email: alertEmail },
      email: {
        subject: `[VisiteCRM] Alerta: ${missingPlans.length} plano(s) com preço Stripe ausente`,
        html: healthAlertHtml(missingPlans, dashboardUrl),
        senderName: "VisiteCRM",
      },
      whatsapp: {
        text: `Alerta VisiteCRM: ${missingPlans.length} plano(s) estão sem preço Stripe correspondente.${dashboardUrl ? ` Painel: ${dashboardUrl}` : ""}`,
      },
      origin: "stripe-health",
      metadata: { dashboardUrl, plans: missingPlans },
    });
  } catch (err) {
    await releaseAlertSlot(today, claim.claimToken, claim.previousValue, claim.rowExisted);
    logger.error({ err }, "[stripe-health] Failed to dispatch alert email — slot released");
    return;
  }
  const alertDelivery = outbound.deliveries.find((item) => item.channel === "email");
  const emailResult = {
    success: alertDelivery?.status === "accepted" || alertDelivery?.status === "pending",
    error: alertDelivery?.lastError ?? alertDelivery?.skippedReason,
  };

  if (emailResult.success) {
    // Slot stays written with today's date+token — other instances will skip.
    try {
      await markStripeHealthUnhealthy();
    } catch (err) {
      logger.error(
        { err },
        "[stripe-health] Alert email was sent but failed to persist recovery state",
      );
    }
    logger.warn(
      {
        to: alertEmail,
        unhealthyCount: unhealthy.length,
        plans: unhealthy.map((r) => r.slug),
      },
      "[stripe-health] Alert email sent — missing Stripe prices detected",
    );
  } else {
    // Release ownership so the next cron run (or a healthy instance) can retry.
    await releaseAlertSlot(today, claim.claimToken, claim.previousValue, claim.rowExisted);
    logger.error(
      { error: emailResult.error, unhealthyCount: unhealthy.length },
      "[stripe-health] Failed to send alert email — slot released, will retry on next cron run",
    );
  }
}
