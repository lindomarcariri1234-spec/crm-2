import { Router, type NextFunction } from "express";
import { z } from "zod/v4";
import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";
import { db, auditLogsTable, OUTBOUND_BOUNCE_TYPES } from "@workspace/db";
import { generateId } from "../lib/id";
import { getClientIp } from "../lib/get-client-ip";
import { requireAuth } from "../lib/tenant";
import { AppError, ValidationError } from "../lib/errors";
import { MAX_EXPORT_ROWS } from "../lib/list-limits";
import {
  dispatchOutboundMessage,
  listOutboundMessages,
  listOutboundProviderFailureSummary,
  retryOutboundDelivery,
} from "../services/outbound-delivery";
import { addOutboundClient, removeOutboundClient } from "../lib/outbound-sse";

applyPlugin(jsPDF);

const router = Router();

router.get("/outbound-messages/stream", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    addOutboundClient(me.tenantId, res);
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(ping);
      }
    }, 30_000);
    req.on("close", () => {
      clearInterval(ping);
      removeOutboundClient(me.tenantId, res);
    });
  } catch (error) {
    next(error);
  }
});

const recipientSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("client"), id: z.string().min(1) }),
  z.object({ type: z.literal("user"), id: z.string().min(1) }),
  z.object({ type: z.literal("admin") }),
  z.object({
    type: z.literal("direct"),
    name: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    whatsapp: z.string().nullable().optional(),
  }),
]);

const createSchema = z.object({
  eventType: z.string().trim().min(1).max(120),
  idempotencyKey: z.string().trim().min(1).max(200),
  recipient: recipientSchema,
  email: z.object({
    subject: z.string().max(500),
    html: z.string().max(500_000),
    senderName: z.string().max(200).nullable().optional(),
  }).optional(),
  whatsapp: z.object({ text: z.string().max(100_000) }).optional(),
  origin: z.string().trim().min(1).max(80).optional(),
  originChannel: z.enum(["email", "whatsapp"]).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  isReplication: z.boolean().optional(),
  replicatedFromId: z.string().nullable().optional(),
}).strict();

type ListedDelivery = Awaited<ReturnType<typeof listOutboundMessages>>[number]["deliveries"][number];
type CreatedDelivery = Awaited<ReturnType<typeof dispatchOutboundMessage>>["deliveries"][number];
type DeliveryForFormat = ListedDelivery | CreatedDelivery;
type MessageForFormat = {
  message: Awaited<ReturnType<typeof listOutboundMessages>>[number]["message"]
    | Awaited<ReturnType<typeof dispatchOutboundMessage>>["message"];
  deliveries: DeliveryForFormat[];
};

function formatDelivery(delivery: DeliveryForFormat) {
  const attempts = "attempts" in delivery && Array.isArray(delivery.attempts) ? delivery.attempts : [];
  return {
    ...delivery,
    attemptHistory: attempts.map((attempt) => ({
      ...attempt,
      startedAt: attempt.startedAt.toISOString(),
      completedAt: attempt.completedAt?.toISOString() ?? null,
    })),
    nextAttemptAt: delivery.nextAttemptAt.toISOString(),
    claimedAt: delivery.claimedAt?.toISOString() ?? null,
    acceptedAt: delivery.acceptedAt?.toISOString() ?? null,
    failedAt: delivery.failedAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
  };
}

function formatMessage(row: MessageForFormat) {
  return {
    ...row.message,
    createdAt: row.message.createdAt.toISOString(),
    updatedAt: row.message.updatedAt.toISOString(),
    deliveries: row.deliveries.map(formatDelivery),
  };
}

const OUTBOUND_STATUSES = ["pending", "processing", "accepted", "partial", "failed", "skipped"] as const;
const OUTBOUND_DELIVERY_STATUSES = ["pending", "processing", "accepted", "failed", "skipped"] as const;
const BRAZIL_TZ = "America/Sao_Paulo";

type OutboundExportRow = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

function buildOutboundCsv(rows: OutboundExportRow[]): string {
  return rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function formatAuditDate(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRAZIL_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatQueryDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return value.split("-").reverse().join("/");
}

function translateDeliveryDetail(value: string | null | undefined, channel: string): string {
  if (!value) return "";
  const normalized = value.trim().toLowerCase();
  if (
    normalized.includes("resend_api_key") ||
    normalized.includes("api key") ||
    normalized.includes("secret") ||
    normalized.includes("token")
  ) {
    return "Falha no provedor";
  }

  const labels: Record<string, string> = {
    credentials_not_configured: "Credenciais do canal não configuradas",
    invalid_phone: "Número de WhatsApp inválido",
    whatsapp_invalid_phone: "Número de WhatsApp inválido",
    email_address_missing: "E-mail do destinatário ausente",
    whatsapp_address_missing: "Número de WhatsApp do destinatário ausente",
    recipient_missing: "Destinatário ausente",
    email_content_missing: "Conteúdo do e-mail ausente",
    whatsapp_content_missing: "Conteúdo do WhatsApp ausente",
    email_opted_out: "Destinatário não autorizou o recebimento de e-mails",
    whatsapp_opted_out: "Destinatário não autorizou o recebimento de WhatsApp",
    provider_unavailable: "Provedor indisponível",
    provider_failed: "O provedor recusou o envio",
    send_failed: "Falha ao enviar",
    outbound_dispatch_failed: "Falha ao programar o envio",
  };
  if (labels[normalized]) return labels[normalized];
  if (normalized.includes("recipient") || normalized.includes("address")) {
    return channel === "email" ? "E-mail do destinatário inválido ou ausente" : "Número de WhatsApp inválido ou ausente";
  }
  if (normalized.includes("credential") || normalized.includes("configur")) return "Credenciais do canal não configuradas";
  if (normalized.includes("timeout") || normalized.includes("unavailable")) return "Provedor indisponível";
  if (normalized.includes("provider") || normalized.includes("send") || normalized.includes("failed")) {
    return "Falha no provedor";
  }
  return "Falha no envio";
}

function parseOutboundFilters(req: { query: Record<string, unknown> }) {
  const rawStatus = typeof req.query.status === "string" ? req.query.status : undefined;
  const status = rawStatus && OUTBOUND_STATUSES.includes(rawStatus as (typeof OUTBOUND_STATUSES)[number])
    ? rawStatus as (typeof OUTBOUND_STATUSES)[number]
    : undefined;
  if (rawStatus && !status) throw new ValidationError("Status inválido.", "VALIDATION_ERROR");

  const channel: "email" | "whatsapp" | undefined = req.query.channel === "email" || req.query.channel === "whatsapp"
    ? req.query.channel
    : undefined;
  if (req.query.channel != null && !channel) throw new ValidationError("Canal inválido.", "VALIDATION_ERROR");

  const rawDeliveryStatus = typeof req.query.deliveryStatus === "string" ? req.query.deliveryStatus : undefined;
  const deliveryStatus = rawDeliveryStatus && OUTBOUND_DELIVERY_STATUSES.includes(rawDeliveryStatus as (typeof OUTBOUND_DELIVERY_STATUSES)[number])
    ? rawDeliveryStatus as (typeof OUTBOUND_DELIVERY_STATUSES)[number]
    : undefined;
  if (rawDeliveryStatus && !deliveryStatus) throw new ValidationError("Status da entrega inválido.", "VALIDATION_ERROR");

  const provider = typeof req.query.provider === "string" ? req.query.provider.trim() : undefined;
  if (provider && provider.length > 80) throw new ValidationError("Provedor inválido.", "VALIDATION_ERROR");
  const providerMissing = provider === "__unknown__";

  const rawBounceType = typeof req.query.bounceType === "string" ? req.query.bounceType : undefined;
  const bounceType = rawBounceType && OUTBOUND_BOUNCE_TYPES.includes(rawBounceType as (typeof OUTBOUND_BOUNCE_TYPES)[number])
    ? rawBounceType as (typeof OUTBOUND_BOUNCE_TYPES)[number]
    : undefined;
  if (rawBounceType && !bounceType) throw new ValidationError("Classificação do bounce inválida.", "VALIDATION_ERROR");

  const dateFrom = typeof req.query.dateFrom === "string"
    ? new Date(`${req.query.dateFrom}T00:00:00.000Z`)
    : undefined;
  const dateTo = typeof req.query.dateTo === "string"
    ? new Date(`${req.query.dateTo}T23:59:59.999Z`)
    : undefined;
  if ((dateFrom && Number.isNaN(dateFrom.getTime())) || (dateTo && Number.isNaN(dateTo.getTime()))) {
    throw new ValidationError("Período inválido.", "VALIDATION_ERROR");
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new ValidationError("A data inicial deve ser anterior ou igual à data final.", "VALIDATION_ERROR");
  }

  return {
    status,
    channel,
    deliveryStatus,
    provider: providerMissing ? undefined : provider || undefined,
    providerMissing,
    clientId: typeof req.query.clientId === "string" && req.query.clientId !== "all" ? req.query.clientId : undefined,
    origin: typeof req.query.origin === "string" && req.query.origin !== "all" ? req.query.origin : undefined,
    eventType: typeof req.query.eventType === "string" ? req.query.eventType : undefined,
    campaignId: typeof req.query.campaignId === "string" ? req.query.campaignId : undefined,
    automationId: typeof req.query.automationId === "string" ? req.query.automationId : undefined,
    bounceType,
    dateFrom,
    dateTo,
  };
}

function buildOutboundExportAuditFilters(
  req: { query: Record<string, unknown> },
  filters: ReturnType<typeof parseOutboundFilters>,
) {
  return {
    status: filters.status ?? null,
    channel: filters.channel ?? null,
    deliveryStatus: filters.deliveryStatus ?? null,
    provider: filters.provider ?? null,
    clientId: filters.clientId ?? null,
    origin: filters.origin ?? null,
    eventType: filters.eventType ?? null,
    campaignId: filters.campaignId ?? null,
    automationId: filters.automationId ?? null,
    bounceType: filters.bounceType ?? null,
    dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : null,
    dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : null,
  };
}

function outboundExportRows(rows: Awaited<ReturnType<typeof listOutboundMessages>>): OutboundExportRow[] {
  const result: OutboundExportRow[] = [];
  for (const row of rows) {
    for (const delivery of row.deliveries) {
      result.push([
        row.message.id,
        delivery.id,
        row.message.recipientName ?? row.message.recipientId ?? "",
        delivery.recipient ?? "",
        delivery.channel === "email" ? "E-mail" : "WhatsApp",
        row.message.eventType,
        row.message.origin,
        row.message.status === "partial"
          ? "Falha parcial"
          : row.message.status === "accepted"
            ? "Aceito"
            : row.message.status === "pending"
              ? "Pendente"
              : row.message.status === "processing"
                ? "Processando"
                : row.message.status === "failed"
                  ? "Falhou"
                  : "Ignorado",
        String(delivery.attempts),
        translateDeliveryDetail(delivery.lastError, delivery.channel),
        translateDeliveryDetail(delivery.skippedReason, delivery.channel),
        delivery.bounceType === "permanent" ? "Permanente" : delivery.bounceType === "temporary" ? "Temporário" : "",
      ]);
    }
  }
  return result;
}

router.get("/outbound-messages/export", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const format = req.query.format === "pdf" ? "pdf" : req.query.format === "csv" ? "csv" : null;
    if (!format) {
      next(new ValidationError("Formato de exportação inválido. Use csv ou pdf.", "VALIDATION_ERROR"));
      return;
    }
    const filters = parseOutboundFilters({ query: req.query as Record<string, unknown> });
    const rows = await listOutboundMessages(me.tenantId, {
      ...filters,
      limit: MAX_EXPORT_ROWS + 1,
      maxLimit: MAX_EXPORT_ROWS + 1,
    });
    const exportRows = outboundExportRows(rows);
    if (exportRows.length > MAX_EXPORT_ROWS) {
      next(new ValidationError(`Volume de dados muito grande para exportação direta (limite de ${MAX_EXPORT_ROWS} entregas). Reduza o período.`, "VALIDATION_ERROR"));
      return;
    }

    const headers = [
      "ID da mensagem",
      "ID da entrega",
      "Destinatário",
      "Contato",
      "Canal",
      "Evento",
      "Origem",
      "Status",
      "Tentativas",
      "Erro",
    "Motivo ignorado",
    "Classificação do bounce",
    ];
    const period = filters.dateFrom || filters.dateTo
      ? `${formatQueryDate(req.query.dateFrom) || "início"} a ${formatQueryDate(req.query.dateTo) || "hoje"}`
      : "todos os registros filtrados";
    const slug = new Date().toLocaleDateString("sv-SE", { timeZone: BRAZIL_TZ }).replaceAll("-", "");

    // Keep the audit entry aggregate-only. In particular, never persist the
    // exported message content, recipient data, provider errors, or request
    // query parameters outside this explicit allowlist.
    await db.insert(auditLogsTable).values({
      id: generateId(),
      tenantId: me.tenantId,
      userId: me.id,
      action: "export_outbound_messages",
      entityType: "outbound_messages_export",
      entityId: generateId(),
      after: {
        format,
        filters: buildOutboundExportAuditFilters(req, filters),
        rowCount: exportRows.length,
      },
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"] ?? null,
    });

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv;charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="historico_multicanal_${slug}.csv"`);
      res.send(`\uFEFF${buildOutboundCsv([headers as OutboundExportRow, ...exportRows])}`);
      return;
    }

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as InstanceType<typeof jsPDF> & {
      autoTable: (options: Record<string, unknown>) => void;
    };
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("Histórico multicanal para auditoria", 14, 18);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Período: ${period}`, 14, 25);
    doc.text(`Gerado em: ${formatAuditDate(new Date())}`, 14, 30);
    doc.autoTable({
      startY: 36,
      head: [headers],
      body: exportRows,
      styles: { fontSize: 6 },
      headStyles: { fillColor: [59, 130, 246] },
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="historico_multicanal_${slug}.pdf"`);
    res.send(Buffer.from(doc.output("arraybuffer")));
  } catch (error) {
    next(error);
  }
});

router.post("/outbound-messages", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.message, "VALIDATION_ERROR"));
      return;
    }
    const created = await dispatchOutboundMessage({
      ...parsed.data,
      tenantId: me.tenantId,
      createdById: me.id,
    });
    res.status(created.created ? 201 : 200).json({
      ...formatMessage({ message: created.message, deliveries: created.deliveries }),
      created: created.created,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/outbound-messages", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const filters = parseOutboundFilters({ query: req.query as Record<string, unknown> });
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const rows = await listOutboundMessages(me.tenantId, {
      ...filters,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    res.json(rows.map(formatMessage));
  } catch (error) {
    next(error);
  }
});

router.get("/outbound-messages/provider-failure-summary", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const filters = parseOutboundFilters({ query: req.query as Record<string, unknown> });
    const summary = await listOutboundProviderFailureSummary(me.tenantId, filters);
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

router.post("/outbound-messages/:deliveryId/retry", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await retryOutboundDelivery(me.tenantId, req.params.deliveryId);
    res.status(202).json({ ok: true });
  } catch (error) {
    if (error instanceof Error && ["delivery_not_found", "delivery_not_authorized", "delivery_not_retryable"].includes(error.message)) {
      const messages: Record<string, string> = {
        delivery_not_found: "A entrega não foi encontrada neste espaço de trabalho.",
        delivery_not_authorized: "Esta entrega foi ignorada por opt-out, contato ausente ou número inválido e não pode ser repetida sem corrigir a autorização.",
        delivery_not_retryable: "A entrega não está em um estado que permita nova tentativa.",
      };
      next(new AppError(messages[error.message], error.message === "delivery_not_found" ? 404 : 422, error.message.toUpperCase()));
      return;
    }
    next(error);
  }
});

// Alias kept for clients that address the delivery resource directly.
router.post("/outbound-deliveries/:deliveryId/retry", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await retryOutboundDelivery(me.tenantId, req.params.deliveryId);
    res.status(202).json({ ok: true });
  } catch (error) {
    if (error instanceof Error && ["delivery_not_found", "delivery_not_authorized", "delivery_not_retryable"].includes(error.message)) {
      const messages: Record<string, string> = {
        delivery_not_found: "A entrega não foi encontrada neste espaço de trabalho.",
        delivery_not_authorized: "Esta entrega foi ignorada por opt-out, contato ausente ou número inválido e não pode ser repetida sem corrigir a autorização.",
        delivery_not_retryable: "A entrega não está em um estado que permita nova tentativa.",
      };
      next(new AppError(messages[error.message], error.message === "delivery_not_found" ? 404 : 422, error.message.toUpperCase()));
      return;
    }
    next(error);
  }
});

export default router;