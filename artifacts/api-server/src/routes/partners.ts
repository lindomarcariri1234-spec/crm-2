import { Router, type NextFunction, type Request, type Response } from "express";
import { createHmac, scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { formatBRL, localToday } from "@workspace/shared";
import { db } from "@workspace/db";
import {
  partnersTable,
  partnerProductsTable,
  partnerAvailabilityTable,
  partnerCommissionsTable,
  storeOrdersTable,
  storeOrderItemsTable,
  storeProductsTable,
  storesTable,
} from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, MANAGEMENT_ROLES } from "../lib/tenant";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { generateId } from "../lib/id";

const router = Router();

// ────── Password helpers ──────────────────────────────────────────────────────

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  try {
    const hashBuf = Buffer.from(hash!, "hex");
    const derivedBuf = scryptSync(password, salt!, 64);
    return timingSafeEqual(hashBuf, derivedBuf);
  } catch {
    return false;
  }
}

// ────── Partner JWT helpers ───────────────────────────────────────────────────

function partnerSecret(): string {
  const key = process.env["CREDENTIAL_ENCRYPTION_KEY"];
  if (!key) {
    if (process.env.NODE_ENV !== "development") {
      throw new Error("CREDENTIAL_ENCRYPTION_KEY must be set — partner portal tokens cannot be signed safely without it");
    }
    // Dev-only: generate a non-deterministic placeholder so tests/dev HMAC works
    return crypto.randomUUID() + "_partner_portal_v1";
  }
  return key + "_partner_portal_v1";
}

export function createPartnerToken(partnerId: string): string {
  const payload = JSON.stringify({ partnerId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  const encoded = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", partnerSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyPartnerToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", partnerSecret()).update(encoded).digest("base64url");
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString()) as { partnerId: string; exp: number };
    if (payload.exp < Date.now()) return null;
    return payload.partnerId;
  } catch {
    return null;
  }
}

async function requirePartnerAuth(
  req: Request,
  res: Response,
  next: import("express").NextFunction,
): Promise<{ partnerId: string; tenantId: string; commissionPct: string } | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    next(new AppError("Partner not authenticated", 401, "PARTNER_UNAUTHORIZED"));
    return null;
  }
  const partnerId = verifyPartnerToken(auth.slice(7));
  if (!partnerId) {
    next(new AppError("Invalid or expired token", 401, "PARTNER_TOKEN_INVALID"));
    return null;
  }
  const [partner] = await db
    .select({ id: partnersTable.id, tenantId: partnersTable.tenantId, status: partnersTable.status, commissionPct: partnersTable.commissionPct })
    .from(partnersTable)
    .where(eq(partnersTable.id, partnerId))
    .limit(1);
  if (!partner || partner.status !== "active") {
    next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
    return null;
  }
  return { partnerId: partner.id, tenantId: partner.tenantId, commissionPct: partner.commissionPct };
}

// ════════════════════════════════════════════════════════════════════════════
//  PARTNER PORTAL ROUTES  (JWT auth — no Clerk)
// ════════════════════════════════════════════════════════════════════════════

// POST /api/partner/login
router.post("/partner/login", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(1),
      storeSlug: z.string().min(1).max(100),
    }).safeParse(req.body);
    if (!body.success) { next(new ValidationError("Email, senha e código da agência são obrigatórios")); return; }

    // Resolve tenantId from store slug to enforce tenant isolation
    const [store] = await db
      .select({ tenantId: storesTable.tenantId })
      .from(storesTable)
      .where(and(eq(storesTable.slug, body.data.storeSlug), eq(storesTable.isActive, true)))
      .limit(1);
    if (!store) {
      next(new AppError("Agência não encontrada. Verifique o código da agência.", 401, "STORE_NOT_FOUND"));
      return;
    }

    const [partner] = await db
      .select()
      .from(partnersTable)
      .where(and(eq(partnersTable.email, body.data.email.toLowerCase()), eq(partnersTable.tenantId, store.tenantId)))
      .limit(1);

    if (!partner || !partner.passwordHash || !verifyPassword(body.data.password, partner.passwordHash)) {
      next(new AppError("Credenciais inválidas", 401, "INVALID_CREDENTIALS"));
      return;
    }
    if (partner.status === "suspended") {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    if (partner.status === "pending") {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const token = createPartnerToken(partner.id);
    res.json({
      token,
      partner: {
        id: partner.id,
        name: partner.name,
        email: partner.email,
        slug: partner.slug,
        status: partner.status,
        commissionPct: partner.commissionPct,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/partner/me
router.get("/partner/me", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const auth = await requirePartnerAuth(req, res, next);
    if (!auth) return;
    const [partner] = await db.select({
      id: partnersTable.id,
      name: partnersTable.name,
      email: partnersTable.email,
      cnpj: partnersTable.cnpj,
      slug: partnersTable.slug,
      description: partnersTable.description,
      phone: partnersTable.phone,
      logo: partnersTable.logo,
      status: partnersTable.status,
      commissionPct: partnersTable.commissionPct,
    }).from(partnersTable).where(eq(partnersTable.id, auth.partnerId)).limit(1);
    if (!partner) { next(new NotFoundError("Parceiro não encontrado", "NOT_FOUND")); return; }
    res.json(partner);
  } catch (err) { next(err); }
});

// PUT /api/partner/me
router.put("/partner/me", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const auth = await requirePartnerAuth(req, res, next);
    if (!auth) return;
    const body = z.object({
      name: z.string().min(1).max(200).optional(),
      cnpj: z.string().max(20).nullable().optional(),
      description: z.string().max(1000).nullable().optional(),
      phone: z.string().max(30).nullable().optional(),
      logo: z.string().url().nullable().optional(),
    }).safeParse(req.body);
    if (!body.success) { next(new ValidationError(String(body.error.message))); return; }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.name !== undefined) updates.name = body.data.name;
    if (body.data.cnpj !== undefined) updates.cnpj = body.data.cnpj;
    if (body.data.description !== undefined) updates.description = body.data.description;
    if (body.data.phone !== undefined) updates.phone = body.data.phone;
    if (body.data.logo !== undefined) updates.logo = body.data.logo;
    await db.update(partnersTable).set(updates).where(eq(partnersTable.id, auth.partnerId));
    res.status(204).end();
  } catch (err) { next(err); }
});

// GET /api/partner/products
router.get("/partner/products", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const auth = await requirePartnerAuth(req, res, next);
    if (!auth) return;
    const products = await db.select().from(partnerProductsTable)
      .where(eq(partnerProductsTable.partnerId, auth.partnerId))
      .orderBy(desc(partnerProductsTable.createdAt));
    res.json({ data: products });
  } catch (err) { next(err); }
});

// POST /api/partner/products
router.post("/partner/products", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const auth = await requirePartnerAuth(req, res, next);
    if (!auth) return;
    const body = z.object({
      type: z.enum(["passeio", "transfer", "experiencia", "ingresso"]),
      title: z.string().min(1).max(200),
      slug: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).nullable().optional(),
      price: z.number().nonnegative(),
      maxCapacity: z.number().int().min(1).default(10),
      durationMinutes: z.number().int().positive().nullable().optional(),
      meetingPoint: z.string().max(500).nullable().optional(),
      cancellationPolicy: z.string().max(1000).nullable().optional(),
      images: z.array(z.string()).default([]),
    }).safeParse(req.body);
    if (!body.success) { next(new ValidationError(String(body.error.message))); return; }
    const slug = body.data.slug ?? body.data.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 100);
    const id = generateId();
    await db.insert(partnerProductsTable).values({
      id,
      partnerId: auth.partnerId,
      tenantId: auth.tenantId,
      type: body.data.type,
      title: body.data.title,
      slug,
      description: body.data.description ?? null,
      price: body.data.price.toFixed(2),
      maxCapacity: body.data.maxCapacity,
      durationMinutes: body.data.durationMinutes ?? null,
      meetingPoint: body.data.meetingPoint ?? null,
      cancellationPolicy: body.data.cancellationPolicy ?? null,
      images: body.data.images,
      status: "pending",
    });
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

// PUT /api/partner/products/:id
router.put("/partner/products/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const auth = await requirePartnerAuth(req, res, next);
    if (!auth) return;
    const [existing] = await db.select({ id: partnerProductsTable.id })
      .from(partnerProductsTable)
      .where(and(eq(partnerProductsTable.id, req.params.id!), eq(partnerProductsTable.partnerId, auth.partnerId)))
      .limit(1);
    if (!existing) { next(new NotFoundError("Produto não encontrado", "NOT_FOUND")); return; }
    const body = z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).nullable().optional(),
      price: z.number().nonnegative().optional(),
      maxCapacity: z.number().int().min(1).optional(),
      durationMinutes: z.number().int().positive().nullable().optional(),
      meetingPoint: z.string().max(500).nullable().optional(),
      cancellationPolicy: z.string().max(1000).nullable().optional(),
      images: z.array(z.string()).optional(),
    }).safeParse(req.body);
    if (!body.success) { next(new ValidationError(String(body.error.message))); return; }
    const updates: Record<string, unknown> = { updatedAt: new Date(), status: "pending" };
    if (body.data.title !== undefined) updates.title = body.data.title;
    if (body.data.description !== undefined) updates.description = body.data.description;
    if (body.data.price !== undefined) updates.price = body.data.price.toFixed(2);
    if (body.data.maxCapacity !== undefined) updates.maxCapacity = body.data.maxCapacity;
    if (body.data.durationMinutes !== undefined) updates.durationMinutes = body.data.durationMinutes;
    if (body.data.meetingPoint !== undefined) updates.meetingPoint = body.data.meetingPoint;
    if (body.data.cancellationPolicy !== undefined) updates.cancellationPolicy = body.data.cancellationPolicy;
    if (body.data.images !== undefined) updates.images = body.data.images;
    await db.update(partnerProductsTable).set(updates).where(eq(partnerProductsTable.id, existing.id));
    res.status(204).end();
  } catch (err) { next(err); }
});

// DELETE /api/partner/products/:id
router.delete("/partner/products/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const auth = await requirePartnerAuth(req, res, next);
    if (!auth) return;
    await db.delete(partnerProductsTable)
      .where(and(eq(partnerProductsTable.id, req.params.id!), eq(partnerProductsTable.partnerId, auth.partnerId)));
    res.status(204).end();
  } catch (err) { next(err); }
});

// GET /api/partner/products/:id/availability
router.get("/partner/products/:id/availability", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const auth = await requirePartnerAuth(req, res, next);
    if (!auth) return;
    const [product] = await db.select({ id: partnerProductsTable.id })
      .from(partnerProductsTable)
      .where(and(eq(partnerProductsTable.id, req.params.id!), eq(partnerProductsTable.partnerId, auth.partnerId)))
      .limit(1);
    if (!product) { next(new NotFoundError("Produto não encontrado", "NOT_FOUND")); return; }
    const avail = await db.select().from(partnerAvailabilityTable)
      .where(eq(partnerAvailabilityTable.productId, product.id))
      .orderBy(partnerAvailabilityTable.date);
    res.json({ data: avail });
  } catch (err) { next(err); }
});

// PUT /api/partner/products/:id/availability — upsert by date
router.put("/partner/products/:id/availability", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const auth = await requirePartnerAuth(req, res, next);
    if (!auth) return;
    const [product] = await db.select({ id: partnerProductsTable.id })
      .from(partnerProductsTable)
      .where(and(eq(partnerProductsTable.id, req.params.id!), eq(partnerProductsTable.partnerId, auth.partnerId)))
      .limit(1);
    if (!product) { next(new NotFoundError("Produto não encontrado", "NOT_FOUND")); return; }
    const body = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      spotsTotal: z.number().int().min(0),
    }).safeParse(req.body);
    if (!body.success) { next(new ValidationError(String(body.error.message))); return; }
    const [existing] = await db.select({ id: partnerAvailabilityTable.id, spotsUsed: partnerAvailabilityTable.spotsUsed })
      .from(partnerAvailabilityTable)
      .where(and(eq(partnerAvailabilityTable.productId, product.id), eq(partnerAvailabilityTable.date, body.data.date)))
      .limit(1);
    if (existing) {
      await db.update(partnerAvailabilityTable)
        .set({ spotsTotal: body.data.spotsTotal, updatedAt: new Date() })
        .where(eq(partnerAvailabilityTable.id, existing.id));
    } else {
      await db.insert(partnerAvailabilityTable).values({
        id: generateId(),
        productId: product.id,
        date: body.data.date,
        spotsTotal: body.data.spotsTotal,
        spotsUsed: 0,
      });
    }
    res.status(204).end();
  } catch (err) { next(err); }
});

// GET /api/partner/commissions
router.get("/partner/commissions", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const auth = await requirePartnerAuth(req, res, next);
    if (!auth) return;
    const { period } = req.query;
    const conditions = [eq(partnerCommissionsTable.partnerId, auth.partnerId)];
    if (period && typeof period === "string") conditions.push(eq(partnerCommissionsTable.period, period));
    const commissions = await db.select().from(partnerCommissionsTable)
      .where(and(...conditions))
      .orderBy(desc(partnerCommissionsTable.createdAt));
    const totals = commissions.reduce(
      (acc, c) => ({
        gross: acc.gross + Number(c.grossAmount),
        partner: acc.partner + Number(c.partnerAmount),
        agency: acc.agency + Number(c.agencyAmount),
        pending: c.status === "pending" ? acc.pending + Number(c.partnerAmount) : acc.pending,
        paid: c.status === "paid" ? acc.paid + Number(c.partnerAmount) : acc.paid,
      }),
      { gross: 0, partner: 0, agency: 0, pending: 0, paid: 0 },
    );
    res.json({ data: commissions, totals });
  } catch (err) { next(err); }
});

// GET /api/partner/orders
router.get("/partner/orders", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const auth = await requirePartnerAuth(req, res, next);
    if (!auth) return;
    const commissions = await db.select({
      orderId: partnerCommissionsTable.orderId,
      grossAmount: partnerCommissionsTable.grossAmount,
      partnerAmount: partnerCommissionsTable.partnerAmount,
      status: partnerCommissionsTable.status,
      period: partnerCommissionsTable.period,
      createdAt: partnerCommissionsTable.createdAt,
    }).from(partnerCommissionsTable)
      .where(eq(partnerCommissionsTable.partnerId, auth.partnerId))
      .orderBy(desc(partnerCommissionsTable.createdAt))
      .limit(100);
    if (!commissions.length) { res.json({ data: [] }); return; }
    const orderIds = [...new Set(commissions.map(c => c.orderId))];
    const orders = await db.select({
      id: storeOrdersTable.id,
      orderNumber: storeOrdersTable.orderNumber,
      customerName: storeOrdersTable.customerName,
      customerEmail: storeOrdersTable.customerEmail,
      totalAmount: storeOrdersTable.totalAmount,
      status: storeOrdersTable.status,
      paymentStatus: storeOrdersTable.paymentStatus,
      createdAt: storeOrdersTable.createdAt,
    }).from(storeOrdersTable).where(inArray(storeOrdersTable.id, orderIds));
    const orderMap = new Map(orders.map(o => [o.id, o]));
    const data = commissions.map(c => ({ ...c, order: orderMap.get(c.orderId) ?? null }));
    res.json({ data });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES  (Clerk auth, MANAGEMENT_ROLES)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/parceiros
router.get("/parceiros", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role as never)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }
    const partners = await db.select().from(partnersTable)
      .where(eq(partnersTable.tenantId, me.tenantId))
      .orderBy(desc(partnersTable.createdAt));
    res.json({ data: partners });
  } catch (err) { next(err); }
});

// POST /api/parceiros — admin creates a partner + sets initial password
router.post("/parceiros", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role as never)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }
    const body = z.object({
      name: z.string().min(1).max(200),
      email: z.string().email(),
      cnpj: z.string().max(20).nullable().optional(),
      slug: z.string().min(1).max(100).optional(),
      description: z.string().max(1000).nullable().optional(),
      phone: z.string().max(30).nullable().optional(),
      commissionPct: z.number().min(0).max(100).default(30),
      password: z.string().min(6),
    }).safeParse(req.body);
    if (!body.success) { next(new ValidationError(String(body.error.message))); return; }
    const slug = body.data.slug ?? body.data.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 80);
    const id = generateId();
    await db.insert(partnersTable).values({
      id,
      tenantId: me.tenantId,
      name: body.data.name,
      email: body.data.email.toLowerCase(),
      cnpj: body.data.cnpj ?? null,
      slug,
      description: body.data.description ?? null,
      phone: body.data.phone ?? null,
      commissionPct: body.data.commissionPct.toFixed(2),
      passwordHash: hashPassword(body.data.password),
      status: "active",
    });
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

// GET /api/parceiros/commissions — monthly payout report (MUST be before /:id)
router.get("/parceiros/commissions", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role as never)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }
    const { period } = req.query;
    const rawPeriod = typeof period === "string" ? period : "";
    const currentPeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawPeriod)
      ? rawPeriod
      : localToday().slice(0, 7);

    const rows = await db
      .select({
        partnerId: partnerCommissionsTable.partnerId,
        partnerName: partnersTable.name,
        partnerEmail: partnersTable.email,
        grossAmount: sql<number>`SUM(${partnerCommissionsTable.grossAmount})::float`,
        partnerAmount: sql<number>`SUM(${partnerCommissionsTable.partnerAmount})::float`,
        agencyAmount: sql<number>`SUM(${partnerCommissionsTable.agencyAmount})::float`,
        pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${partnerCommissionsTable.status} = 'pending')::int`,
        paidCount: sql<number>`COUNT(*) FILTER (WHERE ${partnerCommissionsTable.status} = 'paid')::int`,
        orderCount: sql<number>`COUNT(DISTINCT ${partnerCommissionsTable.orderId})::int`,
      })
      .from(partnerCommissionsTable)
      .innerJoin(partnersTable, eq(partnersTable.id, partnerCommissionsTable.partnerId))
      .where(and(eq(partnerCommissionsTable.tenantId, me.tenantId), eq(partnerCommissionsTable.period, currentPeriod)))
      .groupBy(partnerCommissionsTable.partnerId, partnersTable.name, partnersTable.email);

    if (req.query["export"] === "pdf") {
      const [year, month] = currentPeriod.split("-");
      const monthNames = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
      const formattedPeriod = `${monthNames[parseInt(month ?? "1") - 1] ?? month} de ${year}`;
      const brl = (v: number) => formatBRL(v);
      const totalGross = rows.reduce((s, r) => s + Number(r.grossAmount), 0);
      const totalPartner = rows.reduce((s, r) => s + Number(r.partnerAmount), 0);
      const totalAgency = rows.reduce((s, r) => s + Number(r.agencyAmount), 0);
      const escHtml = (v: string | null | undefined) => String(v ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
      const rowsHtml = rows.map(r => `
        <tr>
          <td>${escHtml(r.partnerName)}</td>
          <td>${escHtml(r.partnerEmail)}</td>
          <td class="text-right">${r.orderCount}</td>
          <td class="text-right">${brl(Number(r.grossAmount))}</td>
          <td class="text-right">${brl(Number(r.partnerAmount))}</td>
          <td class="text-right">${brl(Number(r.agencyAmount))}</td>
          <td>${r.pendingCount > 0 ? '<span class="badge badge-pending">Pendente</span>' : '<span class="badge badge-paid">Pago</span>'}</td>
        </tr>`).join("");
      const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Repasses ${currentPeriod}</title>
<style>
  body{font-family:Arial,sans-serif;margin:2cm;color:#111;font-size:13px}
  h1{font-size:1.3rem;margin:0 0 4px}
  .sub{color:#555;font-size:.8rem;margin-bottom:1.5rem}
  table{width:100%;border-collapse:collapse}
  th{background:#1e3a5f;color:#fff;padding:8px 10px;text-align:left;font-size:.8rem}
  td{padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:.8rem}
  tr:nth-child(even) td{background:#f9fafb}
  .text-right{text-align:right}
  tfoot td{font-weight:700;background:#f3f4f6;border-top:2px solid #d1d5db}
  .badge{display:inline-block;padding:2px 7px;border-radius:9999px;font-size:.7rem;font-weight:600}
  .badge-pending{background:#fef3c7;color:#92400e}
  .badge-paid{background:#dcfce7;color:#166534}
  @media print{@page{margin:1.5cm}button{display:none}}
</style></head><body>
<h1>Relatório de Repasses</h1>
<p class="sub">Período: <strong>${formattedPeriod}</strong> &nbsp;|&nbsp; Gerado em: ${new Date().toLocaleString("pt-BR")}</p>
<table>
  <thead><tr>
    <th>Parceiro</th><th>E-mail</th><th class="text-right">Pedidos</th>
    <th class="text-right">Bruto</th><th class="text-right">Repasse Parceiro</th>
    <th class="text-right">Receita Agência</th><th>Status</th>
  </tr></thead>
  <tbody>${rowsHtml}</tbody>
  <tfoot><tr>
    <td colspan="2"><strong>TOTAL (${rows.length} parceiros)</strong></td>
    <td class="text-right">${rows.reduce((s, r) => s + r.orderCount, 0)}</td>
    <td class="text-right">${brl(totalGross)}</td>
    <td class="text-right">${brl(totalPartner)}</td>
    <td class="text-right">${brl(totalAgency)}</td>
    <td></td>
  </tr></tfoot>
</table>
<script>setTimeout(()=>window.print(),400);</script>
</body></html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
      return;
    }

    if (req.query["export"] === "csv") {
      const sanitize = (v: string | null | undefined) => {
        const s = String(v ?? "");
        const e = s.replace(/"/g, '""');
        return /^[=+\-@\t]/.test(e) ? `"'${e}"` : `"${e}"`;
      };
      const lines = [
        `RELATÓRIO DE REPASSES — ${currentPeriod}`,
        "Parceiro,Email,Pedidos,Bruto,Repasse Parceiro,Receita Agência,Pendente,Pago",
        ...rows.map(r =>
          `${sanitize(r.partnerName)},${sanitize(r.partnerEmail)},${r.orderCount},${Number(r.grossAmount).toFixed(2)},${Number(r.partnerAmount).toFixed(2)},${Number(r.agencyAmount).toFixed(2)},${r.pendingCount > 0 ? "Sim" : "Não"},${r.paidCount > 0 ? "Parcial" : "Não"}`
        ),
      ];
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="repasses-${currentPeriod}.csv"`);
      res.send("\uFEFF" + lines.join("\r\n"));
      return;
    }

    res.json({ data: rows, period: currentPeriod });
  } catch (err) { next(err); }
});

// PUT /api/parceiros/commissions/:id/mark-paid (MUST be before /:id)
router.put("/parceiros/commissions/:id/mark-paid", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role as never)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }
    await db.update(partnerCommissionsTable)
      .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
      .where(and(eq(partnerCommissionsTable.id, req.params.id!), eq(partnerCommissionsTable.tenantId, me.tenantId)));
    res.status(204).end();
  } catch (err) { next(err); }
});

// GET /api/parceiros/:id
router.get("/parceiros/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role as never)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }
    const [partner] = await db.select({
      id: partnersTable.id,
      name: partnersTable.name,
      email: partnersTable.email,
      cnpj: partnersTable.cnpj,
      slug: partnersTable.slug,
      description: partnersTable.description,
      phone: partnersTable.phone,
      logo: partnersTable.logo,
      status: partnersTable.status,
      commissionPct: partnersTable.commissionPct,
      createdAt: partnersTable.createdAt,
    }).from(partnersTable)
      .where(and(eq(partnersTable.id, req.params.id!), eq(partnersTable.tenantId, me.tenantId)))
      .limit(1);
    if (!partner) { next(new NotFoundError("Parceiro não encontrado", "NOT_FOUND")); return; }
    res.json(partner);
  } catch (err) { next(err); }
});

// PUT /api/parceiros/:id
router.put("/parceiros/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role as never)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }
    const [existing] = await db.select({ id: partnersTable.id })
      .from(partnersTable)
      .where(and(eq(partnersTable.id, req.params.id!), eq(partnersTable.tenantId, me.tenantId)))
      .limit(1);
    if (!existing) { next(new NotFoundError("Parceiro não encontrado", "NOT_FOUND")); return; }
    const body = z.object({
      name: z.string().min(1).max(200).optional(),
      cnpj: z.string().max(20).nullable().optional(),
      description: z.string().max(1000).nullable().optional(),
      phone: z.string().max(30).nullable().optional(),
      status: z.enum(["pending", "active", "suspended"]).optional(),
      commissionPct: z.number().min(0).max(100).optional(),
      password: z.string().min(6).optional(),
    }).safeParse(req.body);
    if (!body.success) { next(new ValidationError(String(body.error.message))); return; }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.name !== undefined) updates.name = body.data.name;
    if (body.data.cnpj !== undefined) updates.cnpj = body.data.cnpj;
    if (body.data.description !== undefined) updates.description = body.data.description;
    if (body.data.phone !== undefined) updates.phone = body.data.phone;
    if (body.data.status !== undefined) updates.status = body.data.status;
    if (body.data.commissionPct !== undefined) updates.commissionPct = body.data.commissionPct.toFixed(2);
    if (body.data.password) updates.passwordHash = hashPassword(body.data.password);
    await db.update(partnersTable).set(updates).where(eq(partnersTable.id, existing.id));
    res.status(204).end();
  } catch (err) { next(err); }
});

// GET /api/parceiros/:id/products
router.get("/parceiros/:id/products", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role as never)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }
    const products = await db.select().from(partnerProductsTable)
      .where(and(eq(partnerProductsTable.partnerId, req.params.id!), eq(partnerProductsTable.tenantId, me.tenantId)))
      .orderBy(desc(partnerProductsTable.createdAt));
    res.json({ data: products });
  } catch (err) { next(err); }
});

// PUT /api/parceiros/:id/products/:pid — approve/reject listing
router.put("/parceiros/:id/products/:pid", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role as never)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }
    const body = z.object({
      status: z.enum(["pending", "active", "rejected"]),
    }).safeParse(req.body);
    if (!body.success) { next(new ValidationError(String(body.error.message))); return; }
    await db.update(partnerProductsTable)
      .set({ status: body.data.status, updatedAt: new Date() })
      .where(and(eq(partnerProductsTable.id, req.params.pid!), eq(partnerProductsTable.tenantId, me.tenantId)));
    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
