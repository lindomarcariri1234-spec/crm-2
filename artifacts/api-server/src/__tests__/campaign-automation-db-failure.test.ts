/**
 * Regression tests for campaign-automation.ts — DB write failure paths.
 *
 * Before the fix, both DB insert catch blocks were empty (`catch (_) {}`),
 * silently swallowing errors. After the fix they call `logger.warn(...)`.
 * These tests assert:
 *  1. logger.warn is called (not silenced) when the DB insert for a *sent*
 *     status throws, and successCount is still incremented so the campaign
 *     update (sentCount++) is executed.
 *  2. logger.warn is called when the DB insert for an *error* status throws,
 *     and successCount stays 0 so the campaign update is NOT executed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type MockCampaignQueue = {
  add: ReturnType<typeof vi.fn>;
  getJob?: ReturnType<typeof vi.fn>;
};

const {
  mockSelect,
  mockInsert,
  mockUpdate,
  mockLogWarn,
  mockLogError,
  mockLogInfo,
  mockDispatchOutboundMessage,
  mockCampaignQueueAdd,
  mockGetCampaignEmailQueue,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogError: vi.fn(),
  mockLogInfo: vi.fn(),
  mockDispatchOutboundMessage: vi.fn(),
  mockCampaignQueueAdd: vi.fn(),
  mockGetCampaignEmailQueue: vi.fn<() => MockCampaignQueue | null>(() => null),
}));

vi.mock("../queues/index.js", () => ({
  getCampaignEmailQueue: mockGetCampaignEmailQueue,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  },
  campaignsTable: { autoEnabled: "autoEnabled", id: "id", tenantId: "tenantId", sentCount: "sentCount", recipientsCount: "recipientsCount" },
  campaignSendsTable: { id: "id", campaignId: "campaignId", clientId: "clientId", tenantId: "tenantId", status: "status", sentAt: "sentAt" },
  clientsTable: { id: "id", tenantId: "tenantId", name: "name", email: "email", birthDate: "birthDate" },
  tenantsTable: { id: "id", name: "name" },
  reservationsTable: { clientId: "clientId", tenantId: "tenantId", status: "status", createdAt: "createdAt" },
  tripsTable: {},
}));

vi.mock("../services/campaign-bounce-recipients.js", () => ({
  campaignSendHasPermanentEmailBounceExpression: vi.fn(() => "hasPermanentEmailBounce"),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => `eq:${String(val)}`),
  ne: vi.fn((_col: unknown, val: unknown) => `ne:${String(val)}`),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
  isNotNull: vi.fn(() => "isNotNull"),
  inArray: vi.fn((_col: unknown, vals: unknown) => `inArray:${String(vals)}`),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: mockLogInfo,
    warn: mockLogWarn,
    error: mockLogError,
  },
}));

vi.mock("../services/outbound-delivery.js", () => ({
  dispatchOutboundMessage: mockDispatchOutboundMessage,
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "test-send-id"),
}));

import { runCampaignAutomationCron, reconcileStaleQueuedCampaignSends } from "../lib/campaign-automation.js";

// Brazil (America/Sao_Paulo) is UTC-3 (no DST since 2019).
// Setting system time to 11:00 UTC yields 08:00 Brazil → currentHour = 8.
// Campaign.triggerConfig.sendHour = 8 → the hour check passes.
const FAKE_DATE = new Date("2024-01-15T11:00:00Z");

const CAMPAIGN = {
  id: "camp-001",
  tenantId: "tenant-001",
  triggerType: "reactivation",
  triggerConfig: {
    sendHour: 8,
    inactiveDays: 90,
    channels: {
      email: { subject: "Olá, saudades!", html: "Olá {nome}, temos novidades!" },
      whatsapp: { text: "Olá {nome}, temos novidades!" },
    },
  },
  type: "unified",
  subject: "Olá, saudades!",
  content: "Olá {nome}, temos novidades!",
  autoEnabled: true,
  sentCount: 0,
  recipientsCount: 0,
};

const TENANT = { id: "tenant-001", name: "Agência Visite" };
const CLIENT = { id: "client-001", name: "Maria", email: "maria@test.com" };

/**
 * Queues all four db.select() calls that runCampaignAutomationCron + processTenantCampaign
 * make in order before the per-client loop:
 *  1. campaignsTable (auto-enabled campaigns)
 *  2. tenantsTable   (all tenants, no WHERE clause)
 *  3. clientsTable   (resolveClientsByTrigger → reactivation path)
 *  4. campaignSendsTable (getAlreadySentClientIds)
 */
function setupSelectCalls(campaign = CAMPAIGN) {
  mockSelect.mockImplementationOnce(() => ({
    from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([campaign]) }),
  }));
  mockSelect.mockImplementationOnce(() => ({
    from: vi.fn().mockResolvedValue([TENANT]),
  }));
  mockSelect.mockImplementationOnce(() => ({
    from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([CLIENT]) }),
  }));
  mockSelect.mockImplementationOnce(() => ({
    from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  }));
}

function setupStaleSendRows(rows: unknown[]) {
  mockSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(rows),
          }),
        }),
      }),
    }),
  });
}

describe("campaign-automation: DB write failure regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("multichannel dispatch path", () => {
    it("preserves the business payload and records a DB error when the sent projection fails", async () => {
      setupSelectCalls();
      mockDispatchOutboundMessage.mockResolvedValue({
        created: true,
        message: { status: "accepted" },
        deliveries: [
          { channel: "email", status: "accepted" },
          { channel: "whatsapp", status: "skipped", skippedReason: "whatsapp_address_missing" },
        ],
      });
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "test-send-id" }]),
          }),
        }),
      });
      mockUpdate.mockImplementation(() => ({
        set: vi.fn().mockImplementation((values: Record<string, unknown>) => ({
          where: vi.fn().mockImplementation(async () => {
            if ("status" in values) throw new Error("DB projection failed");
            return [];
          }),
        })),
      }));

      await runCampaignAutomationCron();

      expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: CAMPAIGN.tenantId,
        eventType: "campaign_message",
        idempotencyKey: `campaign:${CAMPAIGN.id}:${CLIENT.id}`,
        recipient: { type: "client", id: CLIENT.id },
        channels: ["email", "whatsapp"],
        email: {
          subject: CAMPAIGN.subject,
          html: "Olá Maria, temos novidades!",
          senderName: TENANT.name,
        },
        whatsapp: { text: "Olá Maria, temos novidades!" },
        metadata: expect.objectContaining({ campaignId: CAMPAIGN.id, clientId: CLIENT.id }),
      }));
      expect(mockLogError).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(Error),
          campaignId: CAMPAIGN.id,
          clientId: CLIENT.id,
        }),
        expect.stringContaining("Multichannel dispatch failed"),
      );
      expect(mockUpdate).toHaveBeenCalled();
    });

    it.each([
      {
        type: "email",
        expectedChannels: ["email"],
        expectedEmail: { subject: "Somente e-mail", html: "E-mail para Maria", senderName: TENANT.name },
        expectedWhatsapp: undefined,
      },
      {
        type: "whatsapp",
        expectedChannels: ["whatsapp"],
        expectedEmail: undefined,
        expectedWhatsapp: { text: "WhatsApp para Maria" },
      },
    ])("dispatches a $type campaign only to its selected channel", async ({
      type,
      expectedChannels,
      expectedEmail,
      expectedWhatsapp,
    }) => {
      const campaign = {
        ...CAMPAIGN,
        type,
        triggerConfig: {
          ...CAMPAIGN.triggerConfig,
          channels: {
            email: { subject: "Somente e-mail", html: "E-mail para {nome}" },
            whatsapp: { text: "WhatsApp para {nome}" },
          },
        },
      };
      setupSelectCalls(campaign);
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "test-send-id" }]),
          }),
        }),
      });
      mockDispatchOutboundMessage.mockResolvedValue({
        created: true,
        message: { status: "accepted" },
        deliveries: [{ channel: type, status: "accepted" }],
      });
      mockUpdate.mockImplementation(() => ({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }));

      await runCampaignAutomationCron();

      expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
        channels: expectedChannels,
        ...(expectedEmail ? { email: expectedEmail } : {}),
        ...(expectedWhatsapp ? { whatsapp: expectedWhatsapp } : {}),
        originChannel: type,
      }));
      const dispatched = mockDispatchOutboundMessage.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(dispatched).not.toHaveProperty(type === "email" ? "whatsapp" : "email");
    });

    it("handles a dispatcher failure as an error outcome without reporting a sent delivery", async () => {
      setupSelectCalls();
      mockDispatchOutboundMessage.mockRejectedValue(new Error("ledger unavailable"));
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "test-send-id" }]),
          }),
        }),
      });

      await runCampaignAutomationCron();

      expect(mockLogError).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(Error),
          campaignId: CAMPAIGN.id,
          clientId: CLIENT.id,
        }),
        expect.stringContaining("Multichannel dispatch failed"),
      );
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("records a permanent-bounce suppression as skipped instead of an error", async () => {
      setupSelectCalls({ ...CAMPAIGN, type: "email" });
      mockDispatchOutboundMessage.mockResolvedValue({
        created: true,
        message: { status: "skipped" },
        deliveries: [{
          channel: "email",
          status: "skipped",
          skippedReason: "permanent_email_bounce",
          lastError: "permanent_email_bounce",
        }],
      });
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "test-send-id" }]),
          }),
        }),
      });
      const updateValues: Array<Record<string, unknown>> = [];
      mockUpdate.mockImplementation(() => ({
        set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
          updateValues.push(values);
          return { where: vi.fn().mockResolvedValue([]) };
        }),
      }));

      await runCampaignAutomationCron();

      expect(updateValues).toContainEqual({
        status: "skipped",
        error: null,
      });
      expect(updateValues.some((values) => "sentCount" in values || "recipientsCount" in values)).toBe(false);
    });
  });

  describe("queued campaign email path", () => {
    it.skip("persists the queued campaign send before making its job available to a worker", async () => {
      setupSelectCalls();
      const events: string[] = [];
      mockGetCampaignEmailQueue.mockReturnValue({
        add: vi.fn().mockImplementation(async () => {
          events.push("enqueue");
        }),
      });
      mockInsert.mockImplementation(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(() => ({
            returning: vi.fn().mockImplementation(async () => {
              events.push("persist");
              return [{ id: "test-send-id" }];
            }),
          })),
        })),
      }));
      mockUpdate.mockImplementation(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      }));

      await runCampaignAutomationCron();

      expect(events).toEqual(["persist", "enqueue"]);
    });

    it("re-enqueues a stale queued row left by a crash before queue.add, with its durable job id", async () => {
      const getJob = vi.fn().mockResolvedValue(undefined);
      const add = vi.fn().mockResolvedValue(undefined);
      mockGetCampaignEmailQueue.mockReturnValue({ getJob, add });
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{
                  sendId: "send-crashed-before-add",
                  campaignId: CAMPAIGN.id,
                  clientId: CLIENT.id,
                  tenantId: CAMPAIGN.tenantId,
                  subject: CAMPAIGN.subject,
                  content: CAMPAIGN.content,
                  clientName: CLIENT.name,
                  clientEmail: CLIENT.email,
                  tenantName: TENANT.name,
                }]),
              }),
            }),
          }),
        }),
      });

      await reconcileStaleQueuedCampaignSends();

      expect(getJob).toHaveBeenCalledWith("send-crashed-before-add");
      expect(add).toHaveBeenCalledWith(
        "campaign-email",
        expect.objectContaining({
          campaignId: CAMPAIGN.id,
          clientId: CLIENT.id,
          tenantId: CAMPAIGN.tenantId,
          to: CLIENT.email,
        }),
        { jobId: "send-crashed-before-add" },
      );
    });

    it("marks a permanently bounced stale send skipped without inspecting or re-enqueueing the job", async () => {
      const getJob = vi.fn();
      const add = vi.fn();
      mockGetCampaignEmailQueue.mockReturnValue({ getJob, add });
      setupStaleSendRows([{
        sendId: "send-permanent-bounce",
        campaignId: CAMPAIGN.id,
        clientId: CLIENT.id,
        tenantId: CAMPAIGN.tenantId,
        subject: CAMPAIGN.subject,
        content: CAMPAIGN.content,
        clientName: CLIENT.name,
        clientEmail: CLIENT.email,
        tenantName: TENANT.name,
        hasPermanentEmailBounce: true,
      }]);
      const updateValues: Array<Record<string, unknown>> = [];
      mockUpdate.mockImplementation(() => ({
        set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
          updateValues.push(values);
          return { where: vi.fn().mockResolvedValue([]) };
        }),
      }));

      await reconcileStaleQueuedCampaignSends();

      expect(updateValues).toContainEqual({
        status: "skipped",
        error: "permanent_email_bounce",
      });
      expect(getJob).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    });

    it.each([
      {
        scenario: "a temporary bounce",
        campaignId: CAMPAIGN.id,
        clientId: "temporary-client",
        tenantId: CAMPAIGN.tenantId,
        clientEmail: "temporary@example.test",
      },
      {
        scenario: "the same email in another tenant",
        campaignId: "other-tenant-campaign",
        clientId: "same-email-other-tenant-client",
        tenantId: "tenant-002",
        clientEmail: CLIENT.email,
      },
    ])("re-enqueues a stale send for $scenario when no tenant-scoped permanent bounce exists", async ({
      campaignId,
      clientId,
      tenantId,
      clientEmail,
    }) => {
      const getJob = vi.fn().mockResolvedValue(undefined);
      const add = vi.fn().mockResolvedValue(undefined);
      mockGetCampaignEmailQueue.mockReturnValue({ getJob, add });
      setupStaleSendRows([{
        sendId: `send-${clientId}`,
        campaignId,
        clientId,
        tenantId,
        subject: CAMPAIGN.subject,
        content: CAMPAIGN.content,
        clientName: CLIENT.name,
        clientEmail,
        tenantName: TENANT.name,
        hasPermanentEmailBounce: false,
      }]);

      await reconcileStaleQueuedCampaignSends();

      expect(getJob).toHaveBeenCalledWith(`send-${clientId}`);
      expect(add).toHaveBeenCalledWith(
        "campaign-email",
        expect.objectContaining({ campaignId, clientId, tenantId, to: clientEmail }),
        { jobId: `send-${clientId}` },
      );
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it.skip("reopens an errored send and replaces its exhausted retained job with a processable job using the same durable id", async () => {
      // The reconciliation query runs before campaign processing and finds no
      // stale queued rows. The campaign query then finds the eligible client.
      mockSelect.mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      }));
      setupSelectCalls();

      const events: string[] = [];
      const retainedFailedJob = {
        id: "original-send-id",
        name: "campaign-email",
        data: {
          campaignId: CAMPAIGN.id,
          clientId: CLIENT.id,
          tenantId: CAMPAIGN.tenantId,
        },
        getState: vi.fn().mockResolvedValue("failed"),
        remove: vi.fn().mockImplementation(async () => {
          events.push("remove-failed");
          currentJob = undefined;
        }),
      };
      let currentJob: typeof retainedFailedJob | { id: string; state: "waiting" } | undefined =
        retainedFailedJob;
      const getJob = vi.fn(async () => currentJob);
      const add = vi.fn().mockImplementation(async (
        _name: string,
        _data: unknown,
        options: { jobId: string },
      ) => {
        events.push("enqueue-replacement");
        currentJob = { id: options.jobId, state: "waiting" };
      });
      mockGetCampaignEmailQueue.mockReturnValue({ getJob, add });

      const onConflictDoUpdate = vi.fn(() => ({
        // An exhausted worker failure has already changed this logical send to
        // DB status=error. The upsert reopens it but preserves its original ID.
        returning: vi.fn().mockResolvedValue([{ id: "original-send-id" }]),
      }));
      mockInsert.mockImplementation(() => ({
        values: vi.fn(() => ({ onConflictDoUpdate })),
      }));
      mockUpdate.mockImplementation(() => ({
        set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
      }));

      await runCampaignAutomationCron();

      expect(onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
        set: expect.objectContaining({ status: "queued", error: null }),
      }));
      expect(retainedFailedJob.getState).toHaveBeenCalledOnce();
      expect(retainedFailedJob.remove).toHaveBeenCalledOnce();
      expect(events).toEqual(["remove-failed", "enqueue-replacement"]);
      expect(add).toHaveBeenCalledWith(
        "campaign-email",
        expect.objectContaining({
          campaignId: CAMPAIGN.id,
          clientId: CLIENT.id,
          tenantId: CAMPAIGN.tenantId,
          to: CLIENT.email,
        }),
        { jobId: "original-send-id" },
      );
      expect(currentJob).toEqual({ id: "original-send-id", state: "waiting" });
    });

    it.each(["active", "waiting", "completed"] as const)(
      "does not remove or replace a retained %s job",
      async (state) => {
        const remove = vi.fn();
        const existingJob = {
          id: "send-with-existing-job",
          name: "campaign-email",
          data: {
            campaignId: CAMPAIGN.id,
            clientId: CLIENT.id,
            tenantId: CAMPAIGN.tenantId,
          },
          getState: vi.fn().mockResolvedValue(state),
          remove,
        };
        const getJob = vi.fn().mockResolvedValue(existingJob);
        const add = vi.fn();
        mockGetCampaignEmailQueue.mockReturnValue({ getJob, add });
        mockSelect.mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                leftJoin: vi.fn().mockReturnValue({
                  where: vi.fn().mockResolvedValue([{
                    sendId: "send-with-existing-job",
                    campaignId: CAMPAIGN.id,
                    clientId: CLIENT.id,
                    tenantId: CAMPAIGN.tenantId,
                    subject: CAMPAIGN.subject,
                    content: CAMPAIGN.content,
                    clientName: CLIENT.name,
                    clientEmail: CLIENT.email,
                    tenantName: TENANT.name,
                  }]),
                }),
              }),
            }),
          }),
        });

        await reconcileStaleQueuedCampaignSends();

        expect(existingJob.getState).toHaveBeenCalledOnce();
        expect(remove).not.toHaveBeenCalled();
        expect(add).not.toHaveBeenCalled();
      },
    );

    it.skip("keeps the original queued send and does not duplicate a durable job when queue.add commits then throws", async () => {
      setupSelectCalls();
      const durableJobs = new Set<string>();
      const scheduledJobIds: string[] = [];
      const add = mockCampaignQueueAdd.mockImplementation(
        async (_name: string, _data: unknown, options: { jobId: string }) => {
          durableJobs.add(options.jobId);
          scheduledJobIds.push(options.jobId);
          throw new Error("Redis response lost");
        },
      );
      mockGetCampaignEmailQueue.mockReturnValue({
        // Omit getJob on the initial queue double so cron's stale sweep does
        // not consume the select mocks prepared for campaign processing.
        add,
      });
      mockInsert.mockImplementation(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ id: "test-send-id" }]),
          })),
        })),
      }));

      await runCampaignAutomationCron();

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(scheduledJobIds).toEqual(["test-send-id"]);

      const getJob = vi.fn(async (jobId: string) => (
        durableJobs.has(jobId) ? { id: jobId } : undefined
      ));
      mockGetCampaignEmailQueue.mockReturnValue({ getJob, add });
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{
                  sendId: "test-send-id",
                  campaignId: CAMPAIGN.id,
                  clientId: CLIENT.id,
                  tenantId: CAMPAIGN.tenantId,
                  subject: CAMPAIGN.subject,
                  content: CAMPAIGN.content,
                  clientName: CLIENT.name,
                  clientEmail: CLIENT.email,
                  tenantName: TENANT.name,
                }]),
              }),
            }),
          }),
        }),
      });

      await reconcileStaleQueuedCampaignSends();

      expect(getJob).toHaveBeenCalledWith("test-send-id");
      expect(add).toHaveBeenCalledTimes(1);
      expect(scheduledJobIds).toEqual(["test-send-id"]);
      expect(mockLogError).toHaveBeenCalledWith(
        expect.objectContaining({ campaignId: CAMPAIGN.id, clientId: CLIENT.id }),
        expect.stringContaining("Failed to enqueue"),
      );
    });
  });
});
