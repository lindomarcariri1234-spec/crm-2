import { Router, type NextFunction } from "express";
import { db } from "@workspace/db";
import { campaignsTable, npsResponsesTable, clientNpsResponsesTable, productsTable, ordersTable, orderItemsTable, clientsTable, reservationsTable } from "@workspace/db";
import { eq, and, desc, inArray, avg, sql, or } from "drizzle-orm";
import { generateId } from "../lib/id";
import { requireAuth, getTenantUser } from "../lib/tenant";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { z } from "zod";
import { ADMIN_ROLES } from '../lib/tenant';
import { STORE_ORDER_STATUS, STORE_PAYMENT_STATUS } from "@workspace/permissions";
import { resolveSegment } from "../lib/campaign-segment";
import { getAIClientForTenant } from "../lib/ai-client";

const router = Router();

const CreateCampaignBody = z.object({
  name: z.string(),
  type: z.string().default("email"),
  subject: z.string().optional(),
  content: z.string(),
  targetSegment: z.record(z.unknown()).optional(),
  scheduledAt: z.string().optional(),
  triggerType: z.string().optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  autoEnabled: z.boolean().optional(),
});

const UpdateCampaignBody = z.object({
  name: z.string().optional(),
  status: z.string().optional(),
  content: z.string().optional(),
  subject: z.string().optional().nullable(),
  targetSegment: z.record(z.unknown()).optional(),
  scheduledAt: z.string().optional().nullable(),
  triggerType: z.string().optional(),
  triggerConfig: z.record(z.unknown()).optional().nullable(),
  autoEnabled: z.boolean().optional(),
});

const SegmentPreviewBody = z.object({
  gender: z.string().optional(),
  ageMin: z.number().optional(),
  ageMax: z.number().optional(),
  inactiveDays: z.number().optional(),
  tier: z.string().optional(),
  minPurchaseScore: z.number().optional(),
  maxChurnScore: z.number().optional(),
  city: z.string().optional(),
  origin: z.string().optional(),
  tag: z.string().optional(),
  tripId: z.string().optional(),
  classification: z.string().optional(),
  status: z.string().optional(),
  travelPreference: z.string().optional(),
});

const AiContentBody = z.object({
  topic: z.string(),
  destination: z.string().optional(),
  tone: z.string().optional(),
  audience: z.string().optional(),
});

const CreateNpsResponseBody = z.object({
  userId: z.string(),
  orderId: z.string().optional(),
  score: z.number().int().min(0).max(10),
  feedback: z.string().optional(),
});

const SendNpsBody = z.object({
  tripId: z.string(),
  clientIds: z.array(z.string()).optional(),
});

const CreateProductBody = z.object({
  name: z.string(),
  slug: z.string().optional(),
  type: z.string().default("physical"),
  description: z.string().optional(),
  price: z.number(),
  promotionalPrice: z.number().optional(),
  stock: z.number().optional(),
  trackStock: z.boolean().optional(),
  featured: z.boolean().optional(),
});

const UpdateProductBody = z.object({
  name: z.string().optional(),
  price: z.number().optional(),
  promotionalPrice: z.number().optional().nullable(),
  stock: z.number().optional(),
  active: z.boolean().optional(),
  featured: z.boolean().optional(),
  description: z.string().optional().nullable(),
});

const CreateOrderBody = z.object({
  userId: z.string(),
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).optional(),
});

const UpdateOrderBody = z.object({
  status: z.string().optional(),
  paymentStatus: z.string().optional(),
});

function formatCampaign(c: typeof campaignsTable.$inferSelect) {
  return {
    id: c.id, tenantId: c.tenantId, name: c.name, type: c.type,
    status: c.status, subject: c.subject, content: c.content,
    targetSegment: c.targetSegment ?? {},
    scheduledAt: c.scheduledAt?.toISOString() ?? null,
    sentAt: c.sentAt?.toISOString() ?? null,
    recipientsCount: c.recipientsCount, sentCount: c.sentCount,
    deliveredCount: c.deliveredCount, openedCount: c.openedCount, clickedCount: c.clickedCount,
    triggerType: c.triggerType ?? "manual",
    triggerConfig: c.triggerConfig ?? null,
    autoEnabled: c.autoEnabled ?? false,
    createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
  };
}

function formatProduct(p: typeof productsTable.$inferSelect) {
  return {
    id: p.id, tenantId: p.tenantId, name: p.name, slug: p.slug,
    description: p.description, shortDescription: p.shortDescription,
    type: p.type, price: Number(p.price),
    promotionalPrice: p.promotionalPrice ? Number(p.promotionalPrice) : null,
    cost: p.cost ? Number(p.cost) : null,
    stock: p.stock, trackStock: p.trackStock, active: p.active, featured: p.featured,
    createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
  };
}

function formatOrder(o: typeof ordersTable.$inferSelect) {
  return {
    id: o.id, tenantId: o.tenantId, userId: o.userId,
    status: o.status, totalAmount: Number(o.totalAmount),
    finalAmount: Number(o.finalAmount),
    discountApplied: Number(o.discountApplied),
    paymentStatus: o.paymentStatus,
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
  };
}

router.get("/campaigns", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const campaigns = await db.select().from(campaignsTable)
      .where(eq(campaignsTable.tenantId, me.tenantId))
      .orderBy(desc(campaignsTable.createdAt));
    res.json(campaigns.map(formatCampaign));
  } catch (err) {
    next(err);
  }
});

router.post("/campaigns", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateCampaignBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(campaignsTable).values({
      id,
      tenantId: me.tenantId,
      name: parsed.data.name,
      type: parsed.data.type,
      status: "draft",
      subject: parsed.data.subject ?? null,
      content: parsed.data.content,
      targetSegment: parsed.data.targetSegment ?? {},
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
      triggerType: parsed.data.triggerType ?? "manual",
      triggerConfig: parsed.data.triggerConfig ?? null,
      autoEnabled: parsed.data.autoEnabled ?? false,
      createdById: me.id,
    });
    const [campaign] = await db.select().from(campaignsTable)
      .where(and(eq(campaignsTable.id, id), eq(campaignsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!campaign) { next(new AppError("Resource not found", 404, "NOT_FOUND")); return; }
    res.status(201).json(formatCampaign(campaign));
  } catch (err) {
    next(err);
  }
});

router.patch("/campaigns/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = UpdateCampaignBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const updates: Partial<typeof campaignsTable.$inferInsert> = {};
    if (parsed.data.name != null) updates.name = parsed.data.name;
    if (parsed.data.status != null) updates.status = parsed.data.status;
    if (parsed.data.content != null) updates.content = parsed.data.content;
    if (parsed.data.subject !== undefined) updates.subject = parsed.data.subject ?? null;
    if (parsed.data.targetSegment != null) updates.targetSegment = parsed.data.targetSegment;
    if (parsed.data.scheduledAt !== undefined) updates.scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null;
    if (parsed.data.triggerType != null) updates.triggerType = parsed.data.triggerType;
    if (parsed.data.triggerConfig !== undefined) updates.triggerConfig = parsed.data.triggerConfig ?? null;
    if (parsed.data.autoEnabled !== undefined) updates.autoEnabled = parsed.data.autoEnabled;
    await db.update(campaignsTable).set(updates)
      .where(and(eq(campaignsTable.id, req.params.id), eq(campaignsTable.tenantId, me.tenantId)));
    const [campaign] = await db.select().from(campaignsTable)
      .where(and(eq(campaignsTable.id, req.params.id), eq(campaignsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!campaign) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(formatCampaign(campaign));
  } catch (err) {
    next(err);
  }
});

router.delete("/campaigns/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    await db.delete(campaignsTable)
      .where(and(eq(campaignsTable.id, req.params.id), eq(campaignsTable.tenantId, me.tenantId)));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/campaigns/segment-preview", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = SegmentPreviewBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const { count, clientIds } = await resolveSegment(me.tenantId, parsed.data);
    res.json({ count, clientIds: clientIds.slice(0, 20) });
  } catch (err) {
    next(err);
  }
});

router.post("/ai-content", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = AiContentBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const { topic, destination, tone, audience } = parsed.data;

    let aiClient: Awaited<ReturnType<typeof getAIClientForTenant>>;
    try {
      aiClient = await getAIClientForTenant(me.tenantId);
    } catch {
      next(new AppError("Configure a integração de IA nas configurações da agência para usar o Criador de Conteúdo.", 402, "AI_NOT_CONFIGURED"));
      return;
    }

    const prompt = `Você é um especialista em marketing de turismo brasileiro. Crie conteúdo de marketing para uma agência de viagens.
Tema/Destino: ${topic}${destination ? ` — ${destination}` : ""}
Tom: ${tone || "entusiástico e amigável"}
Público-alvo: ${audience || "clientes da agência de viagens"}

Retorne um JSON com exatamente estas 3 chaves:
- "email": HTML completo de e-mail marketing (estrutura simples com <h2>, <p>, <ul> se necessário; inclua variável {nome} no início; foco em conversão)
- "whatsapp": texto para WhatsApp (máx 300 caracteres, use 1-2 emojis relevantes, tom informal mas profissional, inclua variável {nome})
- "instagram": legenda para Instagram (máx 200 caracteres + até 5 hashtags relevantes de turismo/destino)

Use linguagem brasileira. Seja específico, criativo e persuasivo.`;

    const response = await aiClient.client.chat.completions.create({
      model: aiClient.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 1500,
      temperature: 0.75,
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    let parsed2: { email?: string; whatsapp?: string; instagram?: string } = {};
    try { parsed2 = JSON.parse(raw); } catch { parsed2 = {}; }

    res.json({
      email: parsed2.email ?? "",
      whatsapp: parsed2.whatsapp ?? "",
      instagram: parsed2.instagram ?? "",
    });
  } catch (err) {
    next(err);
  }
});

router.get("/nps/summary", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const { tripId, dateFrom, dateTo } = req.query as Record<string, string | undefined>;

    const travelConditions = [eq(clientNpsResponsesTable.tenantId, me.tenantId)];
    if (tripId) travelConditions.push(eq(clientNpsResponsesTable.tripId, tripId));
    if (dateFrom) travelConditions.push(sql`${clientNpsResponsesTable.createdAt} >= ${new Date(dateFrom)}`);
    if (dateTo) travelConditions.push(sql`${clientNpsResponsesTable.createdAt} <= ${new Date(dateTo + "T23:59:59.999Z")}`);

    function categoryAvg(values: (number | null)[]): number | null {
      const valid = values.filter((v): v is number => v !== null);
      if (valid.length === 0) return null;
      return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10;
    }

    if (tripId) {
      const travelResponses = await db
        .select({
          score: clientNpsResponsesTable.score,
          scoreTransport: clientNpsResponsesTable.scoreTransport,
          scoreService: clientNpsResponsesTable.scoreService,
          scoreOrganization: clientNpsResponsesTable.scoreOrganization,
          scoreGuide: clientNpsResponsesTable.scoreGuide,
        })
        .from(clientNpsResponsesTable)
        .where(and(...travelConditions));
      const travelMapped = travelResponses.map(r => ({
        score: r.score,
        classification: r.score >= 9 ? "promoter" : r.score >= 7 ? "passive" : "detractor",
      }));
      const total = travelMapped.length;
      const promoters = travelMapped.filter(r => r.classification === "promoter").length;
      const detractors = travelMapped.filter(r => r.classification === "detractor").length;
      const npsScore = total === 0 ? 0 : Math.round(((promoters - detractors) / total) * 100);
      const avgScore = total === 0 ? 0 : travelMapped.reduce((s, r) => s + r.score, 0) / total;
      return void res.json({
        total,
        promoters,
        passives: travelMapped.filter(r => r.classification === "passive").length,
        detractors,
        npsScore,
        averageScore: Math.round(avgScore * 10) / 10,
        avgTransport: categoryAvg(travelResponses.map(r => r.scoreTransport)),
        avgService: categoryAvg(travelResponses.map(r => r.scoreService)),
        avgOrganization: categoryAvg(travelResponses.map(r => r.scoreOrganization)),
        avgGuide: categoryAvg(travelResponses.map(r => r.scoreGuide)),
      });
    }

    const storeConditions = [eq(npsResponsesTable.tenantId, me.tenantId)];
    if (dateFrom) storeConditions.push(sql`${npsResponsesTable.createdAt} >= ${new Date(dateFrom)}`);
    if (dateTo) storeConditions.push(sql`${npsResponsesTable.createdAt} <= ${new Date(dateTo + "T23:59:59.999Z")}`);

    const [storeResponses, travelResponses] = await Promise.all([
      db.select({ score: npsResponsesTable.score, classification: npsResponsesTable.classification })
        .from(npsResponsesTable)
        .where(and(...storeConditions)),
      db.select({
        score: clientNpsResponsesTable.score,
        scoreTransport: clientNpsResponsesTable.scoreTransport,
        scoreService: clientNpsResponsesTable.scoreService,
        scoreOrganization: clientNpsResponsesTable.scoreOrganization,
        scoreGuide: clientNpsResponsesTable.scoreGuide,
      })
        .from(clientNpsResponsesTable)
        .where(and(...travelConditions)),
    ]);
    const travelMapped = travelResponses.map(r => ({
      score: r.score,
      classification: r.score >= 9 ? "promoter" : r.score >= 7 ? "passive" : "detractor",
    }));
    const all = [...storeResponses, ...travelMapped];
    const total = all.length;
    const promoters = all.filter(r => r.classification === "promoter").length;
    const detractors = all.filter(r => r.classification === "detractor").length;
    const npsScore = total === 0 ? 0 : Math.round(((promoters - detractors) / total) * 100);
    const avg = total === 0 ? 0 : all.reduce((s, r) => s + r.score, 0) / total;
    res.json({
      total,
      promoters,
      passives: all.filter(r => r.classification === "passive").length,
      detractors,
      npsScore,
      averageScore: Math.round(avg * 10) / 10,
      avgTransport: categoryAvg(travelResponses.map(r => r.scoreTransport)),
      avgService: categoryAvg(travelResponses.map(r => r.scoreService)),
      avgOrganization: categoryAvg(travelResponses.map(r => r.scoreOrganization)),
      avgGuide: categoryAvg(travelResponses.map(r => r.scoreGuide)),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/nps", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const { classification, tripId, dateFrom, dateTo } = req.query as Record<string, string | undefined>;

    const travelConditions = [eq(clientNpsResponsesTable.tenantId, me.tenantId)];
    if (tripId) travelConditions.push(eq(clientNpsResponsesTable.tripId, tripId));
    if (dateFrom) travelConditions.push(sql`${clientNpsResponsesTable.createdAt} >= ${new Date(dateFrom)}`);
    if (dateTo) travelConditions.push(sql`${clientNpsResponsesTable.createdAt} <= ${new Date(dateTo + "T23:59:59.999Z")}`);

    const storeConditions = [eq(npsResponsesTable.tenantId, me.tenantId)];
    if (dateFrom) storeConditions.push(sql`${npsResponsesTable.createdAt} >= ${new Date(dateFrom)}`);
    if (dateTo) storeConditions.push(sql`${npsResponsesTable.createdAt} <= ${new Date(dateTo + "T23:59:59.999Z")}`);

    const travelQuery = db
      .select({
        id: clientNpsResponsesTable.id,
        score: clientNpsResponsesTable.score,
        comment: clientNpsResponsesTable.comment,
        createdAt: clientNpsResponsesTable.createdAt,
        clientName: clientsTable.name,
        tripId: clientNpsResponsesTable.tripId,
        scoreTransport: clientNpsResponsesTable.scoreTransport,
        scoreService: clientNpsResponsesTable.scoreService,
        scoreOrganization: clientNpsResponsesTable.scoreOrganization,
        scoreGuide: clientNpsResponsesTable.scoreGuide,
      })
      .from(clientNpsResponsesTable)
      .leftJoin(clientsTable, eq(clientsTable.id, clientNpsResponsesTable.clientId))
      .where(and(...travelConditions))
      .orderBy(desc(clientNpsResponsesTable.createdAt));

    if (tripId) {
      const travelRows = await travelQuery;
      const mapped = travelRows.map(r => ({
        id: r.id,
        tenantId: me.tenantId,
        userId: null as string | null,
        orderId: null as string | null,
        score: r.score,
        classification: (r.score >= 9 ? "promoter" : r.score >= 7 ? "passive" : "detractor") as string,
        feedback: r.comment ?? null,
        clientName: r.clientName ?? null,
        createdAt: r.createdAt.toISOString(),
        source: "travel" as const,
        tripId: r.tripId ?? null,
        scoreTransport: r.scoreTransport ?? null,
        scoreService: r.scoreService ?? null,
        scoreOrganization: r.scoreOrganization ?? null,
        scoreGuide: r.scoreGuide ?? null,
      }));
      const filtered = classification && classification !== "all"
        ? mapped.filter(r => r.classification === classification)
        : mapped;
      return void res.json(filtered);
    }

    const [storeRows, travelRows] = await Promise.all([
      db
        .select({
          id: npsResponsesTable.id,
          tenantId: npsResponsesTable.tenantId,
          userId: npsResponsesTable.userId,
          orderId: npsResponsesTable.orderId,
          score: npsResponsesTable.score,
          classification: npsResponsesTable.classification,
          feedback: npsResponsesTable.feedback,
          createdAt: npsResponsesTable.createdAt,
          clientName: clientsTable.name,
        })
        .from(npsResponsesTable)
        .leftJoin(
          clientsTable,
          and(
            eq(clientsTable.tenantId, npsResponsesTable.tenantId),
            or(
              eq(clientsTable.userId, npsResponsesTable.userId),
              eq(clientsTable.id, npsResponsesTable.userId),
            ),
          ),
        )
        .where(and(...storeConditions))
        .orderBy(desc(npsResponsesTable.createdAt)),
      travelQuery,
    ]);

    const combined = [
      ...storeRows.map(r => ({
        id: r.id,
        tenantId: r.tenantId,
        userId: r.userId,
        orderId: r.orderId,
        score: r.score,
        classification: r.classification,
        feedback: r.feedback,
        clientName: r.clientName ?? null,
        createdAt: r.createdAt.toISOString(),
        source: "store" as const,
        tripId: null as string | null,
        scoreTransport: null as number | null,
        scoreService: null as number | null,
        scoreOrganization: null as number | null,
        scoreGuide: null as number | null,
      })),
      ...travelRows.map(r => ({
        id: r.id,
        tenantId: me.tenantId,
        userId: null as string | null,
        orderId: null as string | null,
        score: r.score,
        classification: (r.score >= 9 ? "promoter" : r.score >= 7 ? "passive" : "detractor") as string,
        feedback: r.comment ?? null,
        clientName: r.clientName ?? null,
        createdAt: r.createdAt.toISOString(),
        source: "travel" as const,
        tripId: r.tripId ?? null,
        scoreTransport: r.scoreTransport ?? null,
        scoreService: r.scoreService ?? null,
        scoreOrganization: r.scoreOrganization ?? null,
        scoreGuide: r.scoreGuide ?? null,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const filtered = classification && classification !== "all"
      ? combined.filter(r => r.classification === classification)
      : combined;

    res.json(filtered);
  } catch (err) {
    next(err);
  }
});

router.post("/nps/send", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = SendNpsBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }

    const { tripId, clientIds } = parsed.data;
    const reservations = await db
      .select({ clientId: reservationsTable.clientId })
      .from(reservationsTable)
      .where(
        and(
          eq(reservationsTable.tenantId, me.tenantId),
          eq(reservationsTable.tripId, tripId),
        ),
      );

    const allClientIds = [...new Set(reservations.map(r => r.clientId).filter((id): id is string => id !== null))];
    const targetIds = clientIds && clientIds.length > 0
      ? allClientIds.filter(id => clientIds.includes(id))
      : allClientIds;

    if (targetIds.length === 0) {
      res.json({ links: [] });
      return;
    }

    const clients = await db
      .select({ id: clientsTable.id, name: clientsTable.name })
      .from(clientsTable)
      .where(
        and(
          eq(clientsTable.tenantId, me.tenantId),
          inArray(clientsTable.id, targetIds),
        ),
      );

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const links = clients.map(c => {
      const token = Buffer.from(`${c.id}:${me.tenantId}:${tripId}`).toString("base64url");
      return { clientId: c.id, clientName: c.name, surveyUrl: `${baseUrl}/nps/survey?token=${token}` };
    });

    res.json({ links });
  } catch (err) {
    next(err);
  }
});

router.post("/nps", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = CreateNpsResponseBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }

    const id = generateId();
    const classification = parsed.data.score >= 9 ? "promoter" : parsed.data.score >= 7 ? "passive" : "detractor";
    await db.insert(npsResponsesTable).values({
      id,
      tenantId: me.tenantId,
      userId: parsed.data.userId,
      orderId: parsed.data.orderId ?? null,
      score: parsed.data.score,
      classification,
      feedback: parsed.data.feedback ?? null,
    });

    const allScores = await db
      .select({ score: npsResponsesTable.score })
      .from(npsResponsesTable)
      .where(
        and(
          eq(npsResponsesTable.userId, parsed.data.userId),
          eq(npsResponsesTable.tenantId, me.tenantId),
        ),
      );
    const avgScore = allScores.length > 0
      ? Math.round(allScores.reduce((sum, r) => sum + r.score, 0) / allScores.length)
      : null;
    await db
      .update(clientsTable)
      .set({ npsScore: avgScore })
      .where(
        and(
          eq(clientsTable.userId, parsed.data.userId),
          eq(clientsTable.tenantId, me.tenantId),
        ),
      );

    const [nps] = await db.select().from(npsResponsesTable)
      .where(and(eq(npsResponsesTable.id, id), eq(npsResponsesTable.tenantId, me.tenantId)))
      .limit(1);
    if (!nps) { next(new AppError("Resource not found", 404, "NOT_FOUND")); return; }
    res.status(201).json({ id: nps.id, score: nps.score, classification: nps.classification });
  } catch (err) {
    next(err);
  }
});

router.get("/products", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const products = await db.select().from(productsTable)
      .where(eq(productsTable.tenantId, me.tenantId))
      .orderBy(desc(productsTable.createdAt));
    res.json(products.map(formatProduct));
  } catch (err) {
    next(err);
  }
});

router.post("/products", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateProductBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    const slug = parsed.data.slug ?? (parsed.data.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + id.slice(0, 4));
    await db.insert(productsTable).values({
      id,
      tenantId: me.tenantId,
      name: parsed.data.name,
      slug,
      type: parsed.data.type,
      description: parsed.data.description ?? null,
      price: String(parsed.data.price),
      promotionalPrice: parsed.data.promotionalPrice ? String(parsed.data.promotionalPrice) : null,
      stock: parsed.data.stock ?? null,
      trackStock: parsed.data.trackStock ?? true,
      featured: parsed.data.featured ?? false,
    });
    const [product] = await db.select().from(productsTable)
      .where(and(eq(productsTable.id, id), eq(productsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!product) { next(new AppError("Resource not found", 404, "NOT_FOUND")); return; }
    res.status(201).json(formatProduct(product));
  } catch (err) {
    next(err);
  }
});

router.patch("/products/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = UpdateProductBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const updates: Partial<typeof productsTable.$inferInsert> = {};
    if (parsed.data.name != null) updates.name = parsed.data.name;
    if (parsed.data.price != null) updates.price = String(parsed.data.price);
    if (parsed.data.promotionalPrice !== undefined) updates.promotionalPrice = parsed.data.promotionalPrice ? String(parsed.data.promotionalPrice) : null;
    if (parsed.data.stock != null) updates.stock = parsed.data.stock;
    if (parsed.data.active != null) updates.active = parsed.data.active;
    if (parsed.data.featured != null) updates.featured = parsed.data.featured;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description ?? null;
    await db.update(productsTable).set(updates)
      .where(and(eq(productsTable.id, req.params.id), eq(productsTable.tenantId, me.tenantId)));
    const [product] = await db.select().from(productsTable)
      .where(and(eq(productsTable.id, req.params.id), eq(productsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!product) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(formatProduct(product));
  } catch (err) {
    next(err);
  }
});

router.delete("/products/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    await db.delete(productsTable)
      .where(and(eq(productsTable.id, req.params.id), eq(productsTable.tenantId, me.tenantId)));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/orders", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const orders = await db.select().from(ordersTable)
      .where(eq(ordersTable.tenantId, me.tenantId))
      .orderBy(desc(ordersTable.createdAt));

    if (orders.length === 0) { res.json([]); return; }

    const orderIds = orders.map(o => o.id);
    const items = await db.select().from(orderItemsTable)
      .where(inArray(orderItemsTable.orderId, orderIds));

    const itemsByOrder = items.reduce<Record<string, typeof orderItemsTable.$inferSelect[]>>((acc, item) => {
      if (!acc[item.orderId]) acc[item.orderId] = [];
      acc[item.orderId].push(item);
      return acc;
    }, {});

    res.json(orders.map(o => ({
      ...formatOrder(o),
      items: (itemsByOrder[o.id] ?? []).map(i => ({
        id: i.id, productId: i.productId, quantity: i.quantity, price: Number(i.price),
      })),
    })));
  } catch (err) {
    next(err);
  }
});

router.post("/orders", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = CreateOrderBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }

    const items = parsed.data.items ?? [];
    let totalAmount = 0;
    const priceMap: Record<string, number> = {};
    for (const item of items) {
      const [product] = await db.select().from(productsTable)
        .where(and(eq(productsTable.id, item.productId), eq(productsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!product) { next(new ValidationError(String(`Product ${item.productId} not found or not in tenant`), "VALIDATION_ERROR")); return; }
      const unitPrice = Number(product.promotionalPrice ?? product.price);
      priceMap[item.productId] = unitPrice;
      totalAmount += unitPrice * item.quantity;
    }

    const id = generateId();
    await db.insert(ordersTable).values({
      id,
      tenantId: me.tenantId,
      userId: parsed.data.userId,
      totalAmount: String(totalAmount),
      discountApplied: "0",
      bonusUsed: "0",
      shippingCost: "0",
      finalAmount: String(totalAmount),
      status: STORE_ORDER_STATUS.PENDING,
      paymentStatus: STORE_PAYMENT_STATUS.PENDING,
    });

    for (const item of items) {
      const unitPrice = priceMap[item.productId]!;
      await db.insert(orderItemsTable).values({
        id: generateId(),
        orderId: id,
        productId: item.productId,
        quantity: item.quantity,
        price: String(unitPrice),
      });
    }

    const [order] = await db.select().from(ordersTable)
      .where(and(eq(ordersTable.id, id), eq(ordersTable.tenantId, me.tenantId)))
      .limit(1);
    if (!order) { next(new AppError("Resource not found", 404, "NOT_FOUND")); return; }
    res.status(201).json(formatOrder(order));
  } catch (err) {
    next(err);
  }
});

router.get("/orders/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const [order] = await db.select().from(ordersTable)
      .where(and(eq(ordersTable.id, req.params.id), eq(ordersTable.tenantId, me.tenantId)))
      .limit(1);
    if (!order) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, req.params.id));
    res.json({
      ...formatOrder(order),
      items: items.map(i => ({
        id: i.id, productId: i.productId, quantity: i.quantity, price: Number(i.price),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/orders/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = UpdateOrderBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const updates: Partial<typeof ordersTable.$inferInsert> = {};
    if (parsed.data.status != null) updates.status = parsed.data.status;
    if (parsed.data.paymentStatus != null) updates.paymentStatus = parsed.data.paymentStatus;
    await db.update(ordersTable).set(updates)
      .where(and(eq(ordersTable.id, req.params.id), eq(ordersTable.tenantId, me.tenantId)));
    const [order] = await db.select().from(ordersTable)
      .where(and(eq(ordersTable.id, req.params.id), eq(ordersTable.tenantId, me.tenantId)))
      .limit(1);
    if (!order) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(formatOrder(order));
  } catch (err) {
    next(err);
  }
});

export default router;
