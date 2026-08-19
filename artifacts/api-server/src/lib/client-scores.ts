import { db, clientsTable, reservationsTable, tripsTable, clientScoresTable } from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getAIClientForTenant } from "./ai-client";
import { generateId } from "./id";
import { logger } from "./logger";

const RESERVATION_STATUS_COMPLETED = "completed";
const RESERVATION_STATUS_CONFIRMED = "confirmed";

function scoreRecency(daysSinceLastTrip: number | null): number {
  if (daysSinceLastTrip === null) return 10;
  if (daysSinceLastTrip <= 30) return 100;
  if (daysSinceLastTrip <= 60) return 80;
  if (daysSinceLastTrip <= 90) return 60;
  if (daysSinceLastTrip <= 180) return 40;
  if (daysSinceLastTrip <= 365) return 20;
  return 5;
}

function scoreFrequency(tripCount: number): number {
  if (tripCount === 0) return 0;
  if (tripCount === 1) return 20;
  if (tripCount === 2) return 40;
  if (tripCount <= 4) return 60;
  if (tripCount <= 7) return 80;
  return 100;
}

function scoreMonetary(totalSpent: number): number {
  if (totalSpent <= 0) return 0;
  if (totalSpent < 1000) return 15;
  if (totalSpent < 3000) return 30;
  if (totalSpent < 7000) return 50;
  if (totalSpent < 15000) return 70;
  return 100;
}

export async function calculateScoresForClient(clientId: string, tenantId: string): Promise<void> {
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(and(eq(clientsTable.id, clientId), eq(clientsTable.tenantId, tenantId)))
    .limit(1);

  if (!client) return;

  const reservations = await db
    .select({
      tripId: reservationsTable.tripId,
      status: reservationsTable.status,
      createdAt: reservationsTable.createdAt,
      tripDepartureDate: tripsTable.departureDate,
      tripName: tripsTable.name,
      tripDestination: tripsTable.destination,
    })
    .from(reservationsTable)
    .leftJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
    .where(and(eq(reservationsTable.clientId, clientId), eq(reservationsTable.tenantId, tenantId)));

  if (reservations.length === 0) return;

  const completedTrips = reservations.filter(
    (r) => r.status === RESERVATION_STATUS_COMPLETED || r.status === RESERVATION_STATUS_CONFIRMED,
  );
  const tripCount = completedTrips.length;

  let daysSinceLastTrip: number | null = null;
  if (completedTrips.length > 0) {
    const sorted = [...completedTrips].sort((a, b) => {
      const da = new Date(a.tripDepartureDate ?? a.createdAt).getTime();
      const db2 = new Date(b.tripDepartureDate ?? b.createdAt).getTime();
      return db2 - da;
    });
    const lastDate = sorted[0].tripDepartureDate ?? sorted[0].createdAt;
    daysSinceLastTrip = Math.floor((Date.now() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24));
  }

  const R = scoreRecency(daysSinceLastTrip);
  const F = scoreFrequency(tripCount);
  const M = scoreMonetary(Number(client.totalSpent));

  const purchaseScore = Math.max(0, Math.min(100, Math.round(R * 0.4 + F * 0.3 + M * 0.3)));
  const recompraScore = Math.max(0, Math.min(100, Math.round(R * 0.25 + F * 0.55 + M * 0.2)));
  const churnScore = Math.max(0, Math.min(100, 100 - purchaseScore));

  let nboTripId: string | null = null;
  let nboReasoning: string | null = null;

  if (reservations.length >= 1) {
    try {
      const { client: aiClient, model } = await getAIClientForTenant(tenantId);

      const upcomingTrips = await db
        .select({
          id: tripsTable.id,
          name: tripsTable.name,
          destination: tripsTable.destination,
          departureDate: tripsTable.departureDate,
        })
        .from(tripsTable)
        .where(
          and(
            eq(tripsTable.tenantId, tenantId),
            sql`${tripsTable.departureDate} > NOW()`,
            sql`${tripsTable.status} != 'cancelled'`,
          ),
        )
        .limit(10);

      if (upcomingTrips.length > 0) {
        const profileLines: string = [
          `Nome: ${client.name}`,
          client.dreamDestinations?.length
            ? `Destinos dos sonhos: ${client.dreamDestinations.join(", ")}`
            : "",
          client.foodPreferences ? `Preferências gastronômicas: ${client.foodPreferences}` : "",
          client.musicalPreferences ? `Preferências musicais: ${client.musicalPreferences}` : "",
          tripCount > 0 ? `Viagens realizadas: ${tripCount}` : "Nenhuma viagem realizada ainda",
          `Total gasto: R$ ${Number(client.totalSpent).toFixed(2)}`,
          completedTrips.length > 0
            ? `Histórico de viagens: ${completedTrips.slice(0, 5).map((t) => `${t.tripName ?? ""}${t.tripDestination ? ` (${t.tripDestination})` : ""}`).join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");

        const tripsStr = upcomingTrips
          .map(
            (t) =>
              `- ID: ${t.id} | ${t.name} | Destino: ${t.destination ?? "não especificado"} | Partida: ${t.departureDate ? new Date(t.departureDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "a definir"}`,
          )
          .join("\n");

        const response = await aiClient.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content:
                'Você é especialista em vendas de viagens. Analise o perfil do cliente e as viagens disponíveis e retorne JSON com: "tripId" (ID exato de uma das viagens listadas) e "reasoning" (1-2 frases em português, personalizada, mencionando o nome do cliente e o motivo da sugestão).',
            },
            {
              role: "user",
              content: `Perfil do cliente:\n${profileLines}\n\nViagens disponíveis:\n${tripsStr}\n\nQual viagem recomendar?`,
            },
          ],
          response_format: { type: "json_object" },
          max_tokens: 300,
          temperature: 0.3,
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content) as { tripId?: string; reasoning?: string };
          if (parsed.tripId && upcomingTrips.some((t) => t.id === parsed.tripId)) {
            nboTripId = parsed.tripId;
            nboReasoning = parsed.reasoning ?? null;
          }
        }
      }
    } catch (err) {
      logger.warn({ err, clientId, tenantId }, "[client-scores] NBO LLM call failed — saving scores without NBO");
    }
  }

  const [existing] = await db
    .select({ id: clientScoresTable.id })
    .from(clientScoresTable)
    .where(and(eq(clientScoresTable.clientId, clientId), eq(clientScoresTable.tenantId, tenantId)))
    .limit(1);

  if (existing) {
    await db
      .update(clientScoresTable)
      .set({
        purchaseScore,
        recompraScore,
        churnScore,
        nboTripId,
        nboReasoning,
        rfmR: R,
        rfmF: F,
        rfmM: String(M),
        calculatedAt: new Date(),
      })
      .where(eq(clientScoresTable.id, existing.id));
  } else {
    await db.insert(clientScoresTable).values({
      id: generateId(),
      clientId,
      tenantId,
      purchaseScore,
      recompraScore,
      churnScore,
      nboTripId,
      nboReasoning,
      rfmR: R,
      rfmF: F,
      rfmM: String(M),
      calculatedAt: new Date(),
    });
  }
}

export async function calculateScoresForAllTenants(): Promise<void> {
  const tenants = await db.selectDistinct({ tenantId: clientsTable.tenantId }).from(clientsTable);

  for (const { tenantId } of tenants) {
    const clients = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(eq(clientsTable.tenantId, tenantId));

    const BATCH = 5;
    for (let i = 0; i < clients.length; i += BATCH) {
      const batch = clients.slice(i, i + BATCH);
      await Promise.allSettled(batch.map((c) => calculateScoresForClient(c.id, tenantId)));
    }
  }
}
