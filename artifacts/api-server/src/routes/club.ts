import { Router, type NextFunction, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  clientsTable,
  clubConfigTable,
  clubBenefitsTable,
  referralsTable,
  reservationsTable,
  tripsTable,
  tenantsTable,
} from "@workspace/db";
import { eq, and, desc, sql, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, MANAGEMENT_ROLES } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { REFERRAL_STATUS, RESERVATION_STATUS } from "@workspace/permissions";
import { generateId } from "../lib/id";

const router = Router();

// ──────────────────── Helpers ────────────────────

function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0] ?? name;
  const lastName = parts[parts.length - 1] ?? "";
  return `${parts[0]} ${lastName.charAt(0).toUpperCase()}.`;
}

/**
 * Resolve the tenant for public club routes.
 * If ?slug=<agency-slug> is present → public access, no auth required.
 * Otherwise → require authenticated session and use me.tenantId.
 * Returns { tenantId, isAdmin } or null (response already sent).
 */
async function resolveClubTenant(
  req: Request,
  res: Response,
  next: import("express").NextFunction,
): Promise<{ tenantId: string; isAdmin: boolean } | null> {
  const slug = req.query["slug"] as string | undefined;

  if (slug) {
    const [tenant] = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, slug))
      .limit(1);

    if (!tenant) {
      next(new NotFoundError("Agência não encontrada", "NOT_FOUND"));
      return null;
    }
    return { tenantId: tenant.id, isAdmin: false };
  }

  // No slug → fall back to authenticated session
  const me = await requireAuth(req, res);
  if (!me) return null;
  return {
    tenantId: me.tenantId,
    isAdmin: MANAGEMENT_ROLES.includes(me.role as never),
  };
}

/**
 * Neutralize CSV formula injection.
 * Wraps the value in quotes and prefixes formula-leading characters with an apostrophe.
 */
function sanitizeCsvCell(value: string | null | undefined): string {
  const str = String(value ?? "");
  const escaped = str.replace(/"/g, '""');
  if (/^[=+\-@\t\r\n]/.test(escaped)) {
    return `"'${escaped}"`;
  }
  return `"${escaped}"`;
}

// ──────────────────── Public / auth-optional routes ────────────────────

// GET /club/config — public via ?slug=... or authenticated session
router.get("/club/config", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const resolved = await resolveClubTenant(req, res, next);
    if (!resolved) return;

    const [config] = await db
      .select()
      .from(clubConfigTable)
      .where(eq(clubConfigTable.tenantId, resolved.tenantId))
      .limit(1);

    res.json({
      clubName: config?.clubName ?? "Clube Visite",
      description: config?.description ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /club/benefits — public via ?slug=... or authenticated session
router.get("/club/benefits", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const resolved = await resolveClubTenant(req, res, next);
    if (!resolved) return;

    const benefits = await db
      .select()
      .from(clubBenefitsTable)
      .where(eq(clubBenefitsTable.tenantId, resolved.tenantId))
      .orderBy(clubBenefitsTable.tier, clubBenefitsTable.sortOrder);

    res.json({ data: benefits });
  } catch (err) {
    next(err);
  }
});

// GET /club/ranking — public via ?slug=... or authenticated session
// Public / client access: top-10 opt-in only, names masked
// Admin session: all clients, full names
router.get("/club/ranking", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const resolved = await resolveClubTenant(req, res, next);
    if (!resolved) return;
    const { tenantId, isAdmin } = resolved;

    const referrersRaw = await db
      .select({
        clientId: referralsTable.referrerId,
        name: clientsTable.name,
        count: sql<number>`COUNT(${referralsTable.id})::int`,
      })
      .from(referralsTable)
      .innerJoin(
        clientsTable,
        isAdmin
          ? eq(clientsTable.id, referralsTable.referrerId)
          : and(eq(clientsTable.id, referralsTable.referrerId), eq(clientsTable.ambassadorOptIn, true)),
      )
      .where(
        and(
          eq(referralsTable.tenantId, tenantId),
          inArray(referralsTable.status, [REFERRAL_STATUS.COMPLETED, REFERRAL_STATUS.CONVERTED]),
          sql`DATE_TRUNC('month', ${referralsTable.createdAt}) = DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')`,
        ),
      )
      .groupBy(referralsTable.referrerId, clientsTable.name)
      .orderBy(desc(sql`COUNT(${referralsTable.id})`))
      .limit(10);

    // Only COMPLETED trips (return_date in current month) — not "confirmed pending" trips
    const travelersRaw = await db
      .select({
        clientId: reservationsTable.clientId,
        name: clientsTable.name,
        count: sql<number>`COUNT(${reservationsTable.id})::int`,
      })
      .from(reservationsTable)
      .innerJoin(tripsTable, eq(tripsTable.id, reservationsTable.tripId))
      .innerJoin(
        clientsTable,
        isAdmin
          ? and(eq(clientsTable.id, reservationsTable.clientId), isNotNull(reservationsTable.clientId))
          : and(
              eq(clientsTable.id, reservationsTable.clientId),
              eq(clientsTable.ambassadorOptIn, true),
              isNotNull(reservationsTable.clientId),
            ),
      )
      .where(
        and(
          eq(reservationsTable.tenantId, tenantId),
          eq(reservationsTable.status, RESERVATION_STATUS.COMPLETED),
          isNotNull(reservationsTable.clientId),
          sql`DATE_TRUNC('month', ${tripsTable.returnDate}) = DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')`,
        ),
      )
      .groupBy(reservationsTable.clientId, clientsTable.name)
      .orderBy(desc(sql`COUNT(${reservationsTable.id})`))
      .limit(10);

    res.json({
      referrers: referrersRaw.map((r, i) => ({
        rank: i + 1,
        name: isAdmin ? r.name : maskName(r.name),
        count: r.count,
      })),
      travelers: travelersRaw.map((r, i) => ({
        rank: i + 1,
        name: isAdmin ? r.name : maskName(r.name),
        count: r.count,
      })),
      month: new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7),
    });
  } catch (err) {
    next(err);
  }
});

// ──────────────────── Admin-only routes ────────────────────

// PUT /club/config — admin only
router.put("/club/config", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role as never)) {
      next(new ForbiddenError("Acesso restrito a administradores", "FORBIDDEN_ROLE"));
      return;
    }

    const body = z.object({
      clubName: z.string().min(1).max(100),
      description: z.string().max(500).nullable().optional(),
    }).safeParse(req.body);
    if (!body.success) {
      next(new ValidationError(String(body.error.message)));
      return;
    }

    const [existing] = await db
      .select({ id: clubConfigTable.id })
      .from(clubConfigTable)
      .where(eq(clubConfigTable.tenantId, me.tenantId))
      .limit(1);

    if (existing) {
      await db
        .update(clubConfigTable)
        .set({ clubName: body.data.clubName, description: body.data.description ?? null, updatedAt: new Date() })
        .where(eq(clubConfigTable.id, existing.id));
    } else {
      await db.insert(clubConfigTable).values({
        id: generateId(),
        tenantId: me.tenantId,
        clubName: body.data.clubName,
        description: body.data.description ?? null,
        updatedAt: new Date(),
      });
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /club/benefits — admin only
router.post("/club/benefits", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role as never)) {
      next(new ForbiddenError("Acesso restrito a administradores", "FORBIDDEN_ROLE"));
      return;
    }

    const body = z.object({
      tier: z.enum(["bronze", "silver", "gold", "diamond"]),
      benefitKey: z.string().min(1).max(100),
      label: z.string().min(1).max(200),
      description: z.string().max(500).nullable().optional(),
      value: z.string().max(200).nullable().optional(),
      sortOrder: z.number().int().min(0).default(0),
    }).safeParse(req.body);
    if (!body.success) {
      next(new ValidationError(String(body.error.message)));
      return;
    }

    const id = generateId();
    await db.insert(clubBenefitsTable).values({
      id,
      tenantId: me.tenantId,
      tier: body.data.tier,
      benefitKey: body.data.benefitKey,
      label: body.data.label,
      description: body.data.description ?? null,
      value: body.data.value ?? null,
      sortOrder: body.data.sortOrder,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

// PUT /club/benefits/:id — admin only
router.put("/club/benefits/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role as never)) {
      next(new ForbiddenError("Acesso restrito a administradores", "FORBIDDEN_ROLE"));
      return;
    }

    const { id } = req.params;
    const [existing] = await db
      .select({ id: clubBenefitsTable.id })
      .from(clubBenefitsTable)
      .where(and(eq(clubBenefitsTable.id, id!), eq(clubBenefitsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!existing) {
      next(new NotFoundError("Benefício não encontrado", "NOT_FOUND"));
      return;
    }

    const body = z.object({
      tier: z.enum(["bronze", "silver", "gold", "diamond"]).optional(),
      benefitKey: z.string().min(1).max(100).optional(),
      label: z.string().min(1).max(200).optional(),
      description: z.string().max(500).nullable().optional(),
      value: z.string().max(200).nullable().optional(),
      sortOrder: z.number().int().min(0).optional(),
    }).safeParse(req.body);
    if (!body.success) {
      next(new ValidationError(String(body.error.message)));
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.tier !== undefined) updates.tier = body.data.tier;
    if (body.data.benefitKey !== undefined) updates.benefitKey = body.data.benefitKey;
    if (body.data.label !== undefined) updates.label = body.data.label;
    if (body.data.description !== undefined) updates.description = body.data.description;
    if (body.data.value !== undefined) updates.value = body.data.value;
    if (body.data.sortOrder !== undefined) updates.sortOrder = body.data.sortOrder;

    await db.update(clubBenefitsTable).set(updates).where(eq(clubBenefitsTable.id, id!));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// DELETE /club/benefits/:id — admin only
router.delete("/club/benefits/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role as never)) {
      next(new ForbiddenError("Acesso restrito a administradores", "FORBIDDEN_ROLE"));
      return;
    }

    const { id } = req.params;
    await db
      .delete(clubBenefitsTable)
      .where(and(eq(clubBenefitsTable.id, id!), eq(clubBenefitsTable.tenantId, me.tenantId)));

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// GET /club/ranking/full — admin only (full names, optional CSV export)
router.get("/club/ranking/full", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role as never)) {
      next(new ForbiddenError("Acesso restrito a administradores", "FORBIDDEN_ROLE"));
      return;
    }

    const referrersRaw = await db
      .select({
        clientId: referralsTable.referrerId,
        name: clientsTable.name,
        email: clientsTable.email,
        ambassadorOptIn: clientsTable.ambassadorOptIn,
        count: sql<number>`COUNT(${referralsTable.id})::int`,
      })
      .from(referralsTable)
      .innerJoin(clientsTable, eq(clientsTable.id, referralsTable.referrerId))
      .where(
        and(
          eq(referralsTable.tenantId, me.tenantId),
          inArray(referralsTable.status, [REFERRAL_STATUS.COMPLETED, REFERRAL_STATUS.CONVERTED]),
          sql`DATE_TRUNC('month', ${referralsTable.createdAt}) = DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')`,
        ),
      )
      .groupBy(referralsTable.referrerId, clientsTable.name, clientsTable.email, clientsTable.ambassadorOptIn)
      .orderBy(desc(sql`COUNT(${referralsTable.id})`))
      .limit(50);

    const travelersRaw = await db
      .select({
        clientId: reservationsTable.clientId,
        name: clientsTable.name,
        email: clientsTable.email,
        ambassadorOptIn: clientsTable.ambassadorOptIn,
        count: sql<number>`COUNT(${reservationsTable.id})::int`,
      })
      .from(reservationsTable)
      .innerJoin(tripsTable, eq(tripsTable.id, reservationsTable.tripId))
      .innerJoin(
        clientsTable,
        and(eq(clientsTable.id, reservationsTable.clientId), isNotNull(reservationsTable.clientId)),
      )
      .where(
        and(
          eq(reservationsTable.tenantId, me.tenantId),
          eq(reservationsTable.status, RESERVATION_STATUS.COMPLETED),
          isNotNull(reservationsTable.clientId),
          sql`DATE_TRUNC('month', ${tripsTable.returnDate}) = DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')`,
        ),
      )
      .groupBy(reservationsTable.clientId, clientsTable.name, clientsTable.email, clientsTable.ambassadorOptIn)
      .orderBy(desc(sql`COUNT(${reservationsTable.id})`))
      .limit(50);

    if (req.query["export"] === "csv") {
      const month = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
      const lines: string[] = [
        `RANKING DE INDICADORES - ${month}`,
        "Posição,Nome,Email,Indicações,Embaixador",
        ...referrersRaw.map((r, i) =>
          `${i + 1},${sanitizeCsvCell(r.name)},${sanitizeCsvCell(r.email)},${r.count},${r.ambassadorOptIn ? "Sim" : "Não"}`
        ),
        "",
        `RANKING DE VIAJANTES - ${month}`,
        "Posição,Nome,Email,Viagens,Embaixador",
        ...travelersRaw.map((r, i) =>
          `${i + 1},${sanitizeCsvCell(r.name)},${sanitizeCsvCell(r.email)},${r.count},${r.ambassadorOptIn ? "Sim" : "Não"}`
        ),
      ];
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="ranking-embaixadores-${month}.csv"`);
      res.send("\uFEFF" + lines.join("\r\n"));
      return;
    }

    res.json({
      referrers: referrersRaw.map((r, i) => ({ rank: i + 1, ...r })),
      travelers: travelersRaw.map((r, i) => ({ rank: i + 1, ...r })),
      month: new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
