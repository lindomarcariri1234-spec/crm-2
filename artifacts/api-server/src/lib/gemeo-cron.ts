import { db, tenantsTable, gemeoAlertsTable, gemeoOpportunitiesTable } from "@workspace/db";
import { formatDateBR } from "@workspace/shared";
import { and, eq, isNull, asc } from "drizzle-orm";
import { getAIClientForTenant } from "./ai-client";
import { generateId } from "./id";
import { logger } from "./logger";
import { buildMetrics } from "../routes/gemeo";

const MAX_ACTIVE_ALERTS = 5;
const MAX_ACTIVE_OPPORTUNITIES = 3;

function fmtBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(v);
}

async function getAllTenantIds(): Promise<string[]> {
  const rows = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable);
  return rows.map((r) => r.id);
}

async function getTenantName(tenantId: string): Promise<string> {
  const [row] = await db
    .select({ name: tenantsTable.name })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  return row?.name ?? "Agência";
}

// ─── Daily alerts cron ────────────────────────────────────────────────────────

async function runGemeoAlertsForTenant(tenantId: string): Promise<void> {
  const agencyName = await getTenantName(tenantId);
  const metrics = await buildMetrics(tenantId);

  const { revenueMTD, revenueMTDPrev, opportunitySignals } = metrics.kpis;
  const { churnSignals, npsAvg30d } = metrics.retention;
  const { tripsAtRisk, avgOccupancy, activeTrips } = metrics.operation;
  const riskTrips = metrics.operation.futureTrips
    .filter((t) => t.atRisk)
    .slice(0, 3)
    .map((t) => `  - ${t.name} (${t.daysUntil}d, ${t.fillRate}% lotada)`)
    .join("\n");

  const changePct =
    revenueMTDPrev > 0
      ? ((revenueMTD - revenueMTDPrev) / revenueMTDPrev) * 100
      : null;
  const changeStr =
    changePct !== null
      ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%`
      : "sem comparativo";
  const today = formatDateBR(new Date());

  const prompt = `Você é o Gêmeo Digital de uma agência de turismo brasileira.
Com base no snapshot abaixo, gere ENTRE 2 E 3 alertas executivos CONCISOS e ACIONÁVEIS.
Retorne APENAS um array JSON válido, sem markdown, no formato:
[{"category":"occupancy|churn|revenue|opportunity","severity":"low|medium|high","message":"<máx 120 chars>","action_url":"<rota interna como /trips, /clients, /nps, /pipeline ou null>"}]

Snapshot da agência "${agencyName}" em ${today}:
- Receita MTD: ${fmtBRL(revenueMTD)} (vs ${fmtBRL(revenueMTDPrev)} mês anterior: ${changeStr})
- Reservas esta semana: ${metrics.kpis.reservationsThisWeek}
- NPS médio 30d: ${npsAvg30d !== null ? npsAvg30d.toFixed(1) + "/10" : "sem dados"} (${metrics.kpis.npsCount30d} respostas)
- Viagens ativas: ${activeTrips} | Ocupação média: ${avgOccupancy}%
- Viagens em risco (<30d partida, <50% lotadas): ${tripsAtRisk}${riskTrips ? "\n" + riskTrips : ""}
- Sinais de churn (score >70): ${churnSignals} clientes
- Oportunidades de compra (score >70, idle 90d): ${opportunitySignals} clientes`;

  let newAlerts: Array<{
    category: string;
    severity: string;
    message: string;
    action_url: string | null;
  }> = [];

  try {
    const { client: aiClient, model } = await getAIClientForTenant(tenantId);
    const response = await aiClient.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 600,
    });
    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const jsonStart = raw.indexOf("[");
    const jsonEnd = raw.lastIndexOf("]");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
      if (Array.isArray(parsed)) {
        newAlerts = parsed
          .filter(
            (a) =>
              typeof a.message === "string" &&
              ["occupancy", "churn", "revenue", "opportunity"].includes(a.category) &&
              ["low", "medium", "high"].includes(a.severity),
          )
          .slice(0, 3);
      }
    }
  } catch (err) {
    logger.warn({ err, tenantId }, "[gemeo-cron/alerts] AI unavailable, using fallback");
    // Deterministic fallback alerts based on metrics
    if (tripsAtRisk > 0) {
      newAlerts.push({
        category: "occupancy",
        severity: "high",
        message: `${tripsAtRisk} viagem(ns) com partida próxima e ocupação abaixo de 50%. Acione vendas agora.`,
        action_url: "/trips",
      });
    }
    if (churnSignals > 5) {
      newAlerts.push({
        category: "churn",
        severity: "medium",
        message: `${churnSignals} clientes com alto risco de churn identificados. Envie campanha de reativação.`,
        action_url: "/clients",
      });
    }
    if (opportunitySignals > 3) {
      newAlerts.push({
        category: "opportunity",
        severity: "low",
        message: `${opportunitySignals} clientes prontos para comprar não reservaram nos últimos 90 dias.`,
        action_url: "/clients",
      });
    }
    if (newAlerts.length === 0) {
      newAlerts.push({
        category: "revenue",
        severity: "low",
        message: `Receita MTD: ${fmtBRL(revenueMTD)} (${changeStr} vs mês anterior). Monitore o ritmo de fechamentos.`,
        action_url: "/analytics",
      });
    }
  }

  if (newAlerts.length === 0) return;

  // Enforce max active alerts — delete oldest undismissed if needed
  const existing = await db
    .select({ id: gemeoAlertsTable.id })
    .from(gemeoAlertsTable)
    .where(and(eq(gemeoAlertsTable.tenantId, tenantId), isNull(gemeoAlertsTable.dismissedAt)))
    .orderBy(asc(gemeoAlertsTable.generatedAt));

  const toDelete = existing.length + newAlerts.length - MAX_ACTIVE_ALERTS;
  if (toDelete > 0) {
    const idsToDelete = existing.slice(0, toDelete).map((r) => r.id);
    for (const id of idsToDelete) {
      await db
        .update(gemeoAlertsTable)
        .set({ dismissedAt: new Date() })
        .where(eq(gemeoAlertsTable.id, id));
    }
  }

  const now = new Date();
  for (const alert of newAlerts) {
    await db.insert(gemeoAlertsTable).values({
      id: generateId(),
      tenantId,
      message: String(alert.message).slice(0, 200),
      category: String(alert.category),
      severity: String(alert.severity),
      actionUrl: alert.action_url ?? null,
      generatedAt: now,
    });
  }

  logger.info({ tenantId, count: newAlerts.length }, "[gemeo-cron/alerts] Generated alerts");
}

export async function runGemeoAlertsCron(): Promise<void> {
  logger.info("[gemeo-cron/alerts] Starting daily alerts cron");
  const tenantIds = await getAllTenantIds();

  for (const tenantId of tenantIds) {
    try {
      await runGemeoAlertsForTenant(tenantId);
    } catch (err) {
      logger.error({ err, tenantId }, "[gemeo-cron/alerts] Failed for tenant");
    }
  }

  logger.info({ count: tenantIds.length }, "[gemeo-cron/alerts] Completed");
}

// ─── Weekly opportunities cron ───────────────────────────────────────────────

async function runGemeoOpportunitiesForTenant(tenantId: string): Promise<void> {
  const agencyName = await getTenantName(tenantId);
  const metrics = await buildMetrics(tenantId);

  const { revenueMTD, opportunitySignals } = metrics.kpis;
  const { churnSignals, npsAvg30d } = metrics.retention;
  const { tripsAtRisk } = metrics.operation;

  const prompt = `Você é o Gêmeo Digital de uma agência de turismo brasileira.
Com base no snapshot semanal abaixo, gere EXATAMENTE 3 oportunidades estratégicas PRIORIZADAS para maximizar receita e retenção esta semana.
Retorne APENAS um array JSON válido, sem markdown, no formato:
[{"title":"<ação concisa, máx 60 chars>","description":"<1-2 frases objetivas, máx 150 chars>","action_url":"<rota interna como /comunicacao/campanhas, /clients, /trips, /nps ou null>"}]

Snapshot semanal da agência "${agencyName}":
- Receita MTD: ${fmtBRL(revenueMTD)}
- Clientes com alta intenção de compra (idle 90d): ${opportunitySignals}
- Clientes em risco de churn: ${churnSignals}
- Viagens com baixa ocupação: ${tripsAtRisk}
- NPS médio: ${npsAvg30d !== null ? npsAvg30d.toFixed(1) + "/10" : "sem dados"}
- Conversão do mês: ${metrics.growth.conversionRate}% (prev: ${metrics.growth.conversionRatePrev}%)`;

  let newOpportunities: Array<{
    title: string;
    description: string | null;
    action_url: string | null;
  }> = [];

  try {
    const { client: aiClient, model } = await getAIClientForTenant(tenantId);
    const response = await aiClient.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 800,
    });
    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const jsonStart = raw.indexOf("[");
    const jsonEnd = raw.lastIndexOf("]");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
      if (Array.isArray(parsed)) {
        newOpportunities = parsed
          .filter((o) => typeof o.title === "string")
          .slice(0, 3);
      }
    }
  } catch (err) {
    logger.warn({ err, tenantId }, "[gemeo-cron/opportunities] AI unavailable, using fallback");
    if (opportunitySignals > 0) {
      newOpportunities.push({
        title: "Reativar clientes com alta intenção de compra",
        description: `${opportunitySignals} clientes com score alto não reservaram nos últimos 90 dias. Envie campanha segmentada.`,
        action_url: "/comunicacao/campanhas",
      });
    }
    if (tripsAtRisk > 0) {
      newOpportunities.push({
        title: "Alavancar ocupação de viagens em risco",
        description: `${tripsAtRisk} viagem(ns) próximas com menos de 50% de ocupação. Ofereça promoção ou desconto.`,
        action_url: "/trips",
      });
    }
    if (churnSignals > 0) {
      newOpportunities.push({
        title: "Acionar clientes em risco de abandono",
        description: `${churnSignals} clientes com alto score de churn. Contato proativo pode salvar a relação.`,
        action_url: "/clients",
      });
    }
    if (newOpportunities.length < 3) {
      newOpportunities.push({
        title: "Revisar pipeline e acelerar fechamentos",
        description: "Analise deals em negociação há mais de 7 dias e defina próxima ação.",
        action_url: "/pipeline",
      });
    }
    newOpportunities = newOpportunities.slice(0, 3);
  }

  if (newOpportunities.length === 0) return;

  // Delete all existing undismissed opportunities for this tenant (fresh weekly set)
  const existing = await db
    .select({ id: gemeoOpportunitiesTable.id })
    .from(gemeoOpportunitiesTable)
    .where(
      and(
        eq(gemeoOpportunitiesTable.tenantId, tenantId),
        isNull(gemeoOpportunitiesTable.dismissedAt),
      ),
    );

  const toDelete = existing.length + newOpportunities.length - MAX_ACTIVE_OPPORTUNITIES;
  if (toDelete > 0) {
    for (const row of existing.slice(0, toDelete)) {
      await db
        .update(gemeoOpportunitiesTable)
        .set({ dismissedAt: new Date() })
        .where(eq(gemeoOpportunitiesTable.id, row.id));
    }
  }

  const now = new Date();
  for (const opp of newOpportunities) {
    await db.insert(gemeoOpportunitiesTable).values({
      id: generateId(),
      tenantId,
      title: String(opp.title).slice(0, 120),
      description: opp.description ? String(opp.description).slice(0, 300) : null,
      actionUrl: opp.action_url ?? null,
      generatedAt: now,
    });
  }

  logger.info(
    { tenantId, count: newOpportunities.length },
    "[gemeo-cron/opportunities] Generated opportunities",
  );
}

export async function runGemeoOpportunitiesCron(): Promise<void> {
  logger.info("[gemeo-cron/opportunities] Starting weekly opportunities cron");
  const tenantIds = await getAllTenantIds();

  for (const tenantId of tenantIds) {
    try {
      await runGemeoOpportunitiesForTenant(tenantId);
    } catch (err) {
      logger.error({ err, tenantId }, "[gemeo-cron/opportunities] Failed for tenant");
    }
  }

  logger.info({ count: tenantIds.length }, "[gemeo-cron/opportunities] Completed");
}
