import { Router, type NextFunction } from "express";
import { z } from "zod";
import { ACTIONS, hasPermission, RESOURCES } from "@workspace/permissions";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, ValidationError } from "../lib/errors";
import { currentSaoPauloMonth, loadFinancialMetrics, saoPauloMonthPeriod } from "../services/financial-metrics";

const router = Router();
const Query = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });

router.get("/admin/financial-metrics", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.VIEW)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) { next(new ValidationError("month must be YYYY-MM", "VALIDATION_ERROR")); return; }
    const period = parsed.data.month ? saoPauloMonthPeriod(parsed.data.month) : currentSaoPauloMonth();
    res.json(await loadFinancialMetrics(me.tenantId, period));
  } catch (err) { next(err); }
});

export default router;