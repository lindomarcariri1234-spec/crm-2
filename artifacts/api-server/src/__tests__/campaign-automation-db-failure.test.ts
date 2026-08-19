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

const {
  mockSelect,
  mockInsert,
  mockUpdate,
  mockLogWarn,
  mockLogError,
  mockLogInfo,
  mockSendEmail,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogError: vi.fn(),
  mockLogInfo: vi.fn(),
  mockSendEmail: vi.fn(),
}));

vi.mock("../queues/index.js", () => ({
  getCampaignEmailQueue: vi.fn(() => null),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  },
  campaignsTable: { autoEnabled: "autoEnabled", id: "id", tenantId: "tenantId", sentCount: "sentCount", recipientsCount: "recipientsCount" },
  campaignSendsTable: { campaignId: "campaignId", clientId: "clientId", status: "status", sentAt: "sentAt" },
  clientsTable: { id: "id", tenantId: "tenantId", name: "name", email: "email", birthDate: "birthDate" },
  tenantsTable: { id: "id" },
  reservationsTable: { clientId: "clientId", tenantId: "tenantId", status: "status", createdAt: "createdAt" },
  tripsTable: {},
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

vi.mock("@workspace/email", () => ({
  sendReminderHtmlEmail: mockSendEmail,
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "test-send-id"),
}));

import { runCampaignAutomationCron } from "../lib/campaign-automation.js";

// Brazil (America/Sao_Paulo) is UTC-3 (no DST since 2019).
// Setting system time to 11:00 UTC yields 08:00 Brazil → currentHour = 8.
// Campaign.triggerConfig.sendHour = 8 → the hour check passes.
const FAKE_DATE = new Date("2024-01-15T11:00:00Z");

const CAMPAIGN = {
  id: "camp-001",
  tenantId: "tenant-001",
  triggerType: "reactivation",
  triggerConfig: { sendHour: 8, inactiveDays: 90 },
  type: "email",
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
function setupSelectCalls() {
  mockSelect.mockImplementationOnce(() => ({
    from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([CAMPAIGN]) }),
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

describe("campaign-automation: DB write failure regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("direct-send path (getCampaignEmailQueue returns null)", () => {
    it("calls logger.warn — not silently swallows — when DB insert fails after a successful email send; successCount is still incremented so db.update runs", async () => {
      setupSelectCalls();
      mockSendEmail.mockResolvedValue({ success: true });

      mockInsert.mockImplementation(() => ({
        values: vi.fn().mockImplementation(() => ({
          onConflictDoUpdate: vi.fn().mockRejectedValue(new Error("DB write failed")),
        })),
      }));
      mockUpdate.mockImplementation(() => ({
        set: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      }));

      await runCampaignAutomationCron();

      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(Error),
          campaignId: CAMPAIGN.id,
          clientId: CLIENT.id,
        }),
        expect.stringContaining("Failed to record sent status in DB"),
      );

      expect(mockUpdate).toHaveBeenCalled();

      expect(mockLogError).not.toHaveBeenCalledWith(
        expect.objectContaining({ campaignId: CAMPAIGN.id }),
        expect.stringContaining("Direct send failed"),
      );
    });

    it("calls logger.warn when DB insert fails while recording an error-send status; successCount stays 0 so db.update is NOT called", async () => {
      setupSelectCalls();
      mockSendEmail.mockResolvedValue({ success: false, error: "SMTP error" });

      mockInsert.mockImplementation(() => ({
        values: vi.fn().mockImplementation(() => ({
          onConflictDoUpdate: vi.fn().mockRejectedValue(new Error("DB write failed")),
        })),
      }));

      await runCampaignAutomationCron();

      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(Error),
          campaignId: CAMPAIGN.id,
          clientId: CLIENT.id,
        }),
        expect.stringContaining("Failed to record error status in DB"),
      );

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
