import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSelect,
  mockInsert,
  mockUpdate,
  mockResolveSegment,
  mockDispatchOutboundMessage,
  mockLoggerError,
  mockSql,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockResolveSegment: vi.fn(),
  mockDispatchOutboundMessage: vi.fn(),
  mockLoggerError: vi.fn(),
  mockSql: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  },
  campaignsTable: {
    id: "campaigns.id",
    tenantId: "campaigns.tenant_id",
    status: "campaigns.status",
    triggerType: "campaigns.trigger_type",
    scheduledAt: "campaigns.scheduled_at",
    updatedAt: "campaigns.updated_at",
    targetSegment: "campaigns.target_segment",
    failureTrackingStartedAt: "campaigns.failure_tracking_started_at",
  },
  campaignSendsTable: {
    id: "campaign_sends.id",
    campaignId: "campaign_sends.campaign_id",
    clientId: "campaign_sends.client_id",
    tenantId: "campaign_sends.tenant_id",
    status: "campaign_sends.status",
  },
  clientsTable: {
    id: "clients.id",
    name: "clients.name",
    tenantId: "clients.tenant_id",
  },
  tenantsTable: {
    id: "tenants.id",
    name: "tenants.name",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => values,
  asc: (value: unknown) => value,
  eq: (_column: unknown, value: unknown) => value,
  inArray: (_column: unknown, values: unknown) => values,
  isNotNull: (value: unknown) => value,
  lte: (_column: unknown, value: unknown) => value,
  sql: (...args: unknown[]) => mockSql(...args),
}));

vi.mock("../lib/campaign-segment.js", () => ({
  resolveSegment: mockResolveSegment,
}));

vi.mock("../services/outbound-delivery.js", () => ({
  dispatchOutboundMessage: mockDispatchOutboundMessage,
  htmlToWhatsAppText: (value: string) => value.replace(/<[^>]*>/g, " ").trim(),
}));

vi.mock("../lib/id.js", () => ({
  generateId: () => "campaign-send-1",
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    error: mockLoggerError,
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../lib/safe-error-log.js", () => ({
  safeErrorLogFields: () => ({ errorType: "Error" }),
}));

import {
  runScheduledManualCampaignsCron,
  sendManualCampaignNow,
} from "../lib/manual-campaign-dispatch.js";

const CAMPAIGN = {
  id: "campaign-1",
  tenantId: "tenant-1",
  name: "Oferta da semana",
  type: "unified",
  status: "draft",
  subject: "Olá {nome}",
  content: "<p>Olá {nome}</p>",
  targetSegment: { city: "Juazeiro do Norte" },
  scheduledAt: null,
  sentAt: null,
  recipientsCount: 0,
  sentCount: 0,
  triggerType: "manual",
  triggerConfig: {
    channels: {
      email: { subject: "Olá {nome}", html: "<p>Oferta para {nome}</p>" },
      whatsapp: { text: "Oi {nome}, confira a oferta." },
    },
  },
  autoEnabled: false,
  createdById: "user-1",
  createdAt: new Date("2026-10-19T12:00:00Z"),
  updatedAt: new Date("2026-10-19T12:00:00Z"),
};

const FINISHED_CAMPAIGN = {
  ...CAMPAIGN,
  status: "sent",
  sentAt: new Date("2026-10-19T12:01:00Z"),
  recipientsCount: 1,
  sentCount: 1,
};

function selectChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  chain["from"] = vi.fn(() => chain);
  chain["where"] = vi.fn(() => chain);
  chain["orderBy"] = vi.fn(() => chain);
  chain["limit"] = vi.fn(() => Promise.resolve(result));
  chain["then"] = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function updateChain(returningRows: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  chain["set"] = vi.fn(() => chain);
  chain["where"] = vi.fn(() => chain);
  chain["returning"] = vi.fn(() => Promise.resolve(returningRows));
  chain["then"] = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(returningRows).then(resolve, reject);
  return chain;
}

function setupRecipientDispatch({
  campaign = CAMPAIGN,
  deliveries = [
    { channel: "email", status: "pending", lastError: null },
    { channel: "whatsapp", status: "skipped", skippedReason: "whatsapp_opted_out", lastError: null },
  ],
}: {
  campaign?: typeof CAMPAIGN;
  deliveries?: Array<{ channel: string; status: string; skippedReason?: string; lastError?: string | null }>;
} = {}) {
  mockSelect
    .mockImplementationOnce(() => selectChain([campaign]))
    .mockImplementationOnce(() => selectChain([{ name: "Agência Visite" }]))
    .mockImplementationOnce(() => selectChain([{ id: "client-1", name: "Ana" }]))
    .mockImplementationOnce(() => selectChain([{ status: "sent" }]));

  mockInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "campaign-send-1" }]),
      }),
    }),
  });

  mockUpdate
    .mockImplementationOnce(() => updateChain([{ ...campaign, status: "sending" }]))
    .mockImplementationOnce(() => updateChain())
    .mockImplementationOnce(() => updateChain())
    .mockImplementationOnce(() => updateChain([FINISHED_CAMPAIGN]));

  mockResolveSegment.mockResolvedValue({ count: 1, clientIds: ["client-1"] });
  mockDispatchOutboundMessage.mockResolvedValue({ deliveries });
}

describe("manual campaign dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockReturnValue("sql-expression");
  });

  it("dispatches a unified campaign through the tenant-scoped outbound ledger", async () => {
    setupRecipientDispatch();

    const result = await sendManualCampaignNow("tenant-1", "campaign-1");

    expect(result.status).toBe("sent");
    expect(result.recipientsCount).toBe(1);
    expect(result.sentCount).toBe(1);
    const claimUpdate = mockUpdate.mock.results[0]?.value as {
      set: ReturnType<typeof vi.fn>;
    };
    expect(claimUpdate.set).toHaveBeenCalledWith(expect.objectContaining({
      engagementTrackingStartedAt: "sql-expression",
      failureTrackingStartedAt: "sql-expression",
    }));
    expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1",
      eventType: "campaign_message",
      idempotencyKey: "campaign:campaign-1:client-1",
      recipient: { type: "client", id: "client-1" },
      channels: ["email", "whatsapp"],
      email: {
        subject: "Olá Ana",
        html: "<p>Oferta para Ana</p>",
        senderName: "Agência Visite",
      },
      whatsapp: { text: "Oi Ana, confira a oferta." },
      origin: "campaign",
      metadata: expect.objectContaining({
        campaignId: "campaign-1",
        campaignSendId: "campaign-send-1",
        clientId: "client-1",
      }),
    }));
  });

  it("does not start another send when the campaign was already sent", async () => {
    mockSelect.mockImplementationOnce(() => selectChain([{ ...CAMPAIGN, status: "sent" }]));

    const result = await sendManualCampaignNow("tenant-1", "campaign-1");

    expect(result.status).toBe("sent");
    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("processes due scheduled manual campaigns", async () => {
    const scheduled = {
      ...CAMPAIGN,
      status: "scheduled",
      scheduledAt: new Date("2026-10-19T11:59:00Z"),
    };
    mockSelect
      .mockImplementationOnce(() => selectChain([scheduled]))
      .mockImplementationOnce(() => selectChain([{ name: "Agência Visite" }]))
      .mockImplementationOnce(() => selectChain([{ id: "client-1", name: "Ana" }]))
      .mockImplementationOnce(() => selectChain([{ status: "sent" }]))
      .mockImplementationOnce(() => selectChain([]));
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "campaign-send-1" }]),
        }),
      }),
    });
    mockUpdate
      .mockImplementationOnce(() => updateChain([{ ...scheduled, status: "sending" }]))
      .mockImplementationOnce(() => updateChain())
      .mockImplementationOnce(() => updateChain())
      .mockImplementationOnce(() => updateChain([FINISHED_CAMPAIGN]));
    mockResolveSegment.mockResolvedValue({ count: 1, clientIds: ["client-1"] });
    mockDispatchOutboundMessage.mockResolvedValue({
      deliveries: [{ channel: "email", status: "accepted", lastError: null }],
    });

    await runScheduledManualCampaignsCron();

    expect(mockDispatchOutboundMessage).toHaveBeenCalledTimes(1);
    expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "campaign:campaign-1:client-1",
      channels: ["email", "whatsapp"],
    }));
  });
});
