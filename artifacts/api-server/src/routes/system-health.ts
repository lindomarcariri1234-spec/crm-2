import { Router, type NextFunction } from "express";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { getRedisStatus, fetchUpstashDailyStats, areWorkersEnabled } from "../lib/redis";
import { getWebhookAuditStatus, recheckWebhookAudit } from "../lib/stripeSync";
import { getDriftSnapshot, getOrphanDealsCount, getClientFinancialDriftCount, cleanupOrphanDeals, repairSeatDriftOnly } from "../lib/seat-reconciliation";
import { ROLES } from "@workspace/permissions";

const router = Router();

router.get("/admin/system-health", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);

    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const [redisStatus, dailyStats, webhookAudit, driftSnapshot, orphanDeals, clientFinancialDrift] = await Promise.all([
      Promise.resolve(getRedisStatus()),
      fetchUpstashDailyStats(),
      Promise.resolve(getWebhookAuditStatus()),
      getDriftSnapshot(),
      getOrphanDealsCount(),
      getClientFinancialDriftCount(),
    ]);

    res.json({
      redis: {
        status: redisStatus,
        ...(dailyStats !== null
          ? {
              dailyUsage: {
                commandCount: dailyStats.commandCount,
                maxCommands: dailyStats.maxCommands,
                usagePct: Math.round(dailyStats.usagePct * 10) / 10,
                warningThresholdPct: dailyStats.warningThresholdPct,
              },
            }
          : {}),
      },
      workers: {
        enabled: areWorkersEnabled(),
      },
      stripeWebhookAudit: {
        status: webhookAudit.status,
        duplicateCount: webhookAudit.duplicateCount,
        endpoints: webhookAudit.endpoints,
        checkedAt: webhookAudit.checkedAt,
      },
      seatDrift: {
        tripsChecked: driftSnapshot.tripsChecked,
        tripsWithDrift: driftSnapshot.tripsWithDrift,
        status: driftSnapshot.tripsWithDrift === 0 ? "ok" : "drift_detected",
      },
      pipelineOrphans: {
        openDealsOnCancelledReservations: orphanDeals,
        status: orphanDeals === 0 ? "ok" : "orphans_detected",
      },
      clientFinancialDrift: {
        clientsWithNegativeBalance: clientFinancialDrift,
        status: clientFinancialDrift === 0 ? "ok" : "drift_detected",
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/admin/stripe/audit-webhooks", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);

    const redisStatus = getRedisStatus();
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const audit = await recheckWebhookAudit();
    res.json({ audit });
  } catch (err) {
    next(err);
  }
});

router.post("/admin/system-health/repair-seat-drift", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);

    const redisStatus = getRedisStatus();
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const { fixed, skipped } = await repairSeatDriftOnly();
    res.json({ fixed, skipped });
  } catch (err) {
    next(err);
  }
});

router.post("/admin/system-health/repair", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);

    const redisStatus = getRedisStatus();
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const [{ orphansFixed }, { fixed: tripsCorrected }] = await Promise.all([
      cleanupOrphanDeals(),
      repairSeatDriftOnly(),
    ]);
    res.json({ orphansFixed, tripsCorrected });
  } catch (err) {
    next(err);
  }
});

export default router;

    const dailyStats = await fetchUpstashDailyStats();

    const webhookAudit = getWebhookAuditStatus();
