import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  recomputeClientClassification,
  recordClientClassificationEvent,
} from "../services/client-classification.js";

const PAGE_SIZE = 100;

type Options = {
  tenantId?: string;
  clientId?: string;
  allTenants: boolean;
  apply: boolean;
  help: boolean;
};

type HistoricalEventRow = {
  tenant_id: string;
  client_id: string;
  event_type: string;
  idempotency_key: string;
  source_type: string;
  source_id: string;
  actor_id: string | null;
  occurred_at: Date;
  reason: string;
};

type HistoricalEvent = {
  eventType: string;
  idempotencyKey: string;
  sourceType: string;
  sourceId: string;
  actorId: string | null;
  occurredAt: Date;
  reason: string;
};

function parseArgs(argv: string[]): Options {
  const options: Options = { allTenants: false, apply: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--apply") options.apply = true;
    else if (argument === "--all-tenants") options.allTenants = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("--tenant-id=")) options.tenantId = argument.slice("--tenant-id=".length);
    else if (argument === "--tenant-id") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--tenant-id exige um ID.");
      options.tenantId = value;
      index += 1;
    } else if (argument.startsWith("--client-id=")) options.clientId = argument.slice("--client-id=".length);
    else if (argument === "--client-id") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--client-id exige um ID.");
      options.clientId = value;
      index += 1;
    } else throw new Error(`Argumento desconhecido: ${argument}`);
  }

  if (options.help) return options;
  if (Boolean(options.tenantId) === options.allTenants) {
    throw new Error("Informe exatamente um escopo: --tenant-id <id> ou --all-tenants.");
  }
  if (options.apply && options.allTenants) {
    throw new Error("--apply exige --tenant-id; --all-tenants só pode ser usado em simulação.");
  }
  if (options.clientId && !options.tenantId) {
    throw new Error("--client-id só pode ser usado junto com --tenant-id.");
  }
  if (options.tenantId === "" || options.clientId === "") {
    throw new Error("Os IDs de agência e cliente não podem estar vazios.");
  }
  return options;
}

function clientKey(tenantId: string, clientId: string): string {
  return `${tenantId}\u0000${clientId}`;
}

async function collectHistoricalEvents(options: Options): Promise<Map<string, HistoricalEvent[]>> {
  const tenantScope = options.tenantId ? sql`AND cl.tenant_id = ${options.tenantId}` : sql``;
  const clientScope = options.clientId ? sql`AND cl.id = ${options.clientId}` : sql``;

  const activityResult = await db.execute(sql`
    SELECT
      cl.tenant_id,
      n.client_id,
      CASE WHEN n.type = 'qualification' THEN 'opportunity_qualified' ELSE 'interest_recorded' END AS event_type,
      'client-activity:' || n.id::text AS idempotency_key,
      'client_activity' AS source_type,
      n.id::text AS source_id,
      n.created_by_id::text AS actor_id,
      n.created_at AS occurred_at,
      CASE WHEN n.type = 'qualification'
        THEN 'Atividade histórica de qualificação registrada pela equipe.'
        ELSE 'Atividade histórica identificável registrada no CRM.'
      END AS reason
    FROM notes n
    JOIN clients cl ON cl.id = n.client_id
    WHERE cl.status IS DISTINCT FROM 'merged'
      AND n.type IN ('interest', 'qualification', 'call', 'whatsapp', 'email', 'meeting')
      AND (
        n.created_by_id IS NULL
        OR EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = n.created_by_id AND u.tenant_id = cl.tenant_id
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM client_classification_events e
        WHERE e.tenant_id = cl.tenant_id
          AND e.idempotency_key = 'client-activity:' || n.id::text
      )
      ${tenantScope}
      ${clientScope}
  `);

  const dealResult = await db.execute(sql`
    SELECT
      cl.tenant_id,
      d.client_id,
      'historical_deal' AS event_type,
      'historical-deal:' || d.id::text AS idempotency_key,
      'deal' AS source_type,
      d.id::text AS source_id,
      d.owner_id::text AS actor_id,
      d.created_at AS occurred_at,
      'Deal histórico associado a um cadastro existente no CRM.' AS reason
    FROM deals d
    JOIN clients cl ON cl.id = d.client_id AND cl.tenant_id = d.tenant_id
    WHERE d.client_id IS NOT NULL
      AND cl.status IS DISTINCT FROM 'merged'
      AND EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = d.owner_id AND u.tenant_id = d.tenant_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM client_classification_events e
        WHERE e.tenant_id = d.tenant_id
          AND e.idempotency_key = 'historical-deal:' || d.id::text
      )
      ${tenantScope}
      ${clientScope}
  `);

  const whatsappResult = await db.execute(sql`
    SELECT
      cl.tenant_id,
      conv.client_id,
      'whatsapp_inbound' AS event_type,
      'whatsapp-inbound:' || COALESCE(message.source_message_id::text, message.id::text) AS idempotency_key,
      'chatbot_conversation' AS source_type,
      conv.id::text AS source_id,
      NULL::text AS actor_id,
      message.sent_at AS occurred_at,
      'Mensagem WhatsApp histórica recebida em uma conversa com vínculo verificável.' AS reason
    FROM chatbot_messages message
    JOIN chatbot_conversations conv
      ON conv.id = message.conversation_id AND conv.tenant_id = message.tenant_id
    JOIN clients cl ON cl.id = conv.client_id AND cl.tenant_id = conv.tenant_id
    WHERE conv.channel = 'whatsapp'
      AND message.role = 'user'
      AND message.is_bot = false
      AND NULLIF(BTRIM(message.content), '') IS NOT NULL
      AND conv.client_id IS NOT NULL
      AND cl.status IS DISTINCT FROM 'merged'
      AND COALESCE(conv.metadata->>'identityMatchStatus', '') IN ('matched', 'existing_link', 'auto_created')
      AND NOT EXISTS (
        SELECT 1 FROM client_classification_events link_event
        WHERE link_event.tenant_id = conv.tenant_id
          AND link_event.source_type = 'chatbot_conversation'
          AND link_event.source_id = conv.id::text
          AND link_event.event_type IN (
            'manual_whatsapp_association',
            'manual_whatsapp_unassociation',
            'whatsapp_identity_unlinked',
            'whatsapp_identity_ambiguous'
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM client_classification_events e
        WHERE e.tenant_id = conv.tenant_id
          AND e.idempotency_key =
            'whatsapp-inbound:' || COALESCE(message.source_message_id::text, message.id::text)
      )
      ${tenantScope}
      ${clientScope}
  `);

  const eventsByClient = new Map<string, HistoricalEvent[]>();
  const rows = [
    ...(activityResult as unknown as { rows: HistoricalEventRow[] }).rows,
    ...(dealResult as unknown as { rows: HistoricalEventRow[] }).rows,
    ...(whatsappResult as unknown as { rows: HistoricalEventRow[] }).rows,
  ];
  for (const row of rows) {
    const key = clientKey(row.tenant_id, row.client_id);
    const events = eventsByClient.get(key) ?? [];
    events.push({
      eventType: row.event_type,
      idempotencyKey: row.idempotency_key,
      sourceType: row.source_type,
      sourceId: row.source_id,
      actorId: row.actor_id,
      occurredAt: row.occurred_at,
      reason: row.reason,
    });
    eventsByClient.set(key, events);
  }
  return eventsByClient;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Uso: pnpm --filter @workspace/scripts run backfill:client-classification -- --tenant-id <id> [--client-id <id>] [--apply]\n" +
      "  ou: pnpm --filter @workspace/scripts run backfill:client-classification -- --all-tenants [--apply]\n" +
      "--all-tenants só pode ser usado em simulação; --apply exige --tenant-id.\n" +
      "Sem --apply, o comando apenas simula e não grava dados.",
    );
    return;
  }

  const historicalEvents = await collectHistoricalEvents(options);
  const historicalEventCount = [...historicalEvents.values()].reduce((sum, events) => sum + events.length, 0);
  const report = { scanned: 0, classificationChanges: 0, firstPaidAtBackfills: 0, seededEvents: 0 };
  let offset = 0;

  while (true) {
    const clientsResult = await db.execute(sql`
      SELECT id, tenant_id
      FROM clients
      WHERE status IS DISTINCT FROM 'merged'
        ${options.tenantId ? sql`AND tenant_id = ${options.tenantId}` : sql``}
        ${options.clientId ? sql`AND id = ${options.clientId}` : sql``}
      ORDER BY tenant_id, id
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `);
    const clients = (clientsResult as unknown as { rows: Array<{ id: string; tenant_id: string }> }).rows;
    if (clients.length === 0) break;

    for (const client of clients) {
      report.scanned += 1;
      const candidates = historicalEvents.get(clientKey(client.tenant_id, client.id)) ?? [];
      const previewSignals = {
        lead: candidates.some((event) => event.eventType !== "opportunity_qualified"),
        qualified: candidates.some((event) => event.eventType === "opportunity_qualified"),
      };

      const result = options.apply
        ? await db.transaction(async (tx) => {
            for (const event of candidates) {
              const inserted = await recordClientClassificationEvent({
                tenantId: client.tenant_id,
                clientId: client.id,
                eventType: event.eventType,
                idempotencyKey: event.idempotencyKey,
                sourceType: event.sourceType,
                sourceId: event.sourceId,
                actorId: event.actorId,
                reason: event.reason,
                occurredAt: event.occurredAt,
              }, tx);
              if (inserted) report.seededEvents += 1;
            }
            return recomputeClientClassification({
              tenantId: client.tenant_id,
              clientId: client.id,
              trigger: "classification_backfill",
              reason: "Backfill controlado com evidências históricas verificáveis.",
            }, tx);
          })
        : await recomputeClientClassification({
            tenantId: client.tenant_id,
            clientId: client.id,
            trigger: "classification_backfill",
            reason: "Simulação de backfill com evidências históricas verificáveis.",
            dryRun: true,
            previewSignals,
          });

      if (result?.classificationChanged) report.classificationChanges += 1;
      if (result?.firstPaidAtChanged) report.firstPaidAtBackfills += 1;
      if (result && (result.classificationChanged || result.firstPaidAtChanged || candidates.length > 0)) {
        console.log(JSON.stringify({
          tenantId: client.tenant_id,
          clientId: client.id,
          previousClassification: result.currentClassification,
          classification: result.classification,
          amount: result.amount,
          completedTrips: result.completedTrips,
          firstPaidAt: result.firstPaidAt,
          firstPaidAtChanged: result.firstPaidAtChanged,
          historicalEvents: candidates.length,
          classificationChanged: result.classificationChanged,
        }));
      }
    }

    offset += clients.length;
  }

  console.log(JSON.stringify({
    ...report,
    historicalEventsFound: historicalEventCount,
    mode: options.apply ? "apply" : "dry-run",
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});