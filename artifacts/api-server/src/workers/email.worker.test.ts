import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSelect,
  mockUpdate,
  mockSendReservationConfirmationEmail,
  mockSendReminderHtmlEmail,
  mockWorker,
  mockAnd,
  mockEq,
  processors,
  failedHandlers,
  updateWheres,
  updateSets,
} = vi.hoisted(() => {
  const processors: Array<(job: unknown) => Promise<unknown>> = [];
  const failedHandlers: Array<(job: unknown, err: Error) => Promise<unknown>> = [];
  const updateWheres: unknown[] = [];
  const updateSets: unknown[] = [];
  const set = vi.fn((values: unknown) => {
    updateSets.push(values);
    return {
      where: vi.fn((condition: unknown) => {
        updateWheres.push(condition);
        return Promise.resolve();
      }),
    };
  });

  return {
    mockSelect: vi.fn(),
    mockUpdate: vi.fn(() => ({ set })),
    mockSendReservationConfirmationEmail: vi.fn(),
    mockSendReminderHtmlEmail: vi.fn(),
    mockWorker: vi.fn().mockImplementation((_queue, processor) => {
      processors.push(processor);
      return {
        on: vi.fn((event, handler) => {
          if (event === "failed") failedHandlers.push(handler);
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };
    }),
    mockAnd: vi.fn((...conditions: unknown[]) => ({ conditions })),
    mockEq: vi.fn((column, value) => ({ column, value })),
    processors,
    failedHandlers,
    updateWheres,
    updateSets,
  };
});

vi.mock("bullmq", () => ({ Worker: mockWorker }));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
  emailLogsTable: {
    id: "email_logs.id",
    tenantId: "email_logs.tenant_id",
  },
  campaignSendsTable: {
    id: "campaign_sends.id",
    campaignId: "campaign_sends.campaign_id",
    clientId: "campaign_sends.client_id",
    tenantId: "campaign_sends.tenant_id",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: mockEq,
  and: mockAnd,
}));

vi.mock("@workspace/email", () => ({
  sendReservationConfirmationEmail: mockSendReservationConfirmationEmail,
  sendReservationCancellationEmail: vi.fn(),
  sendBirthdayEmail: vi.fn(),
  sendNewBookingNotificationEmail: vi.fn(),
  sendReferralBonusPaidEmail: vi.fn(),
  sendReferralConvertedEmail: vi.fn(),
  sendReferralExpiredEmail: vi.fn(),
  sendReferralExpiringSoonEmail: vi.fn(),
  sendReferralBonusReleasedEmail: vi.fn(),
  sendReferralWelcomeEmail: vi.fn(),
  sendReminderHtmlEmail: mockSendReminderHtmlEmail,
  sendReferralLoyaltyPointsEmail: vi.fn(),
}));

vi.mock("../lib/redis", () => ({
  getRedisConnection: vi.fn(() => ({})),
}));

vi.mock("../lib/worker-circuit-breaker", () => ({
  attachCircuitBreaker: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { startEmailWorker, stopEmailWorker } from "./email.worker";

function mockScopedLogLookup(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  mockSelect.mockReturnValue({ from });
}

describe("email worker tenant-scoped email logs", () => {
  beforeEach(async () => {
    await stopEmailWorker();
    vi.clearAllMocks();
    processors.length = 0;
    failedHandlers.length = 0;
    updateWheres.length = 0;
    updateSets.length = 0;
  });

  it("skips a job whose email log is not owned by the payload tenant", async () => {
    mockScopedLogLookup([]);
    startEmailWorker();

    await processors[0]({
      id: "job-1",
      name: "reservation-confirmation",
      data: {
        emailLogId: "log-owned-by-another-tenant",
        tenantId: "tenant-a",
        to: "client@example.com",
      },
    });

    expect(mockAnd).toHaveBeenCalledWith(
      { column: "email_logs.id", value: "log-owned-by-another-tenant" },
      { column: "email_logs.tenant_id", value: "tenant-a" },
    );
    expect(mockSendReservationConfirmationEmail).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("sends and updates a log owned by the payload tenant", async () => {
    mockScopedLogLookup([{ id: "log-1" }]);
    mockSendReservationConfirmationEmail.mockResolvedValue({
      success: true,
      messageId: "provider-message-1",
    });
    startEmailWorker();

    await processors[0]({
      id: "job-2",
      name: "reservation-confirmation",
      data: {
        emailLogId: "log-1",
        tenantId: "tenant-a",
        to: "client@example.com",
      },
    });

    expect(mockSendReservationConfirmationEmail).toHaveBeenCalledWith({
      to: "client@example.com",
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(updateSets).toEqual([{
      status: "sent",
      messageId: "provider-message-1",
    }]);
    expect(updateWheres).toEqual([
      {
        conditions: [
          { column: "email_logs.id", value: "log-1" },
          { column: "email_logs.tenant_id", value: "tenant-a" },
        ],
      },
    ]);
  });

  it("records a definitive worker failure only after all retries are exhausted", async () => {
    mockScopedLogLookup([{ id: "log-1" }]);
    mockSendReservationConfirmationEmail.mockResolvedValue({
      success: false,
      error: "recipient rejected",
    });
    startEmailWorker();

    const job = {
      id: "job-failed",
      name: "reservation-confirmation",
      attemptsMade: 3,
      opts: { attempts: 3 },
      data: {
        emailLogId: "log-1",
        tenantId: "tenant-a",
        to: "client@example.com",
      },
    };

    await expect(processors[0](job)).rejects.toThrow("recipient rejected");
    await failedHandlers[0](job, new Error("recipient rejected"));

    expect(updateSets).toEqual([{
      status: "failed",
      errorMessage: "recipient rejected",
    }]);
    expect(updateWheres).toEqual([{
      conditions: [
        { column: "email_logs.id", value: "log-1" },
        { column: "email_logs.tenant_id", value: "tenant-a" },
      ],
    }]);
  });

  it("does not mark the legacy log failed while BullMQ still has retries", async () => {
    mockScopedLogLookup([{ id: "log-1" }]);
    mockSendReservationConfirmationEmail.mockResolvedValue({
      success: false,
      error: "provider unavailable",
    });
    startEmailWorker();

    const job = {
      id: "job-retry",
      name: "reservation-confirmation",
      attemptsMade: 1,
      opts: { attempts: 3 },
      data: {
        emailLogId: "log-1",
        tenantId: "tenant-a",
        to: "client@example.com",
      },
    };

    await expect(processors[0](job)).rejects.toThrow("provider unavailable");
    await failedHandlers[0](job, new Error("provider unavailable"));

    expect(updateSets).toEqual([]);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});


describe("email worker tenant-scoped campaign sends", () => {
  beforeEach(async () => {
    await stopEmailWorker();
    vi.clearAllMocks();
    processors.length = 0;
    failedHandlers.length = 0;
    updateWheres.length = 0;
  });

  it("skips a campaign email whose campaign send is not owned by the payload tenant", async () => {
    mockScopedLogLookup([]);
    startEmailWorker();

    await processors[0]({
      id: "campaign-job-1",
      name: "campaign-email",
      data: {
        to: "client@example.com",
        toName: "Client",
        subject: "A campaign",
        htmlContent: "<p>Hello</p>",
        fromName: "Agency",
        campaignId: "campaign-1",
        clientId: "client-1",
        tenantId: "tenant-a",
      },
    });

    expect(mockAnd).toHaveBeenCalledWith(
      { column: "campaign_sends.id", value: "campaign-job-1" },
      { column: "campaign_sends.campaign_id", value: "campaign-1" },
      { column: "campaign_sends.client_id", value: "client-1" },
      { column: "campaign_sends.tenant_id", value: "tenant-a" },
    );
    expect(mockSendReminderHtmlEmail).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("sends and updates a campaign send owned by the payload tenant", async () => {
    mockScopedLogLookup([{ id: "campaign-send-1" }]);
    mockSendReminderHtmlEmail.mockResolvedValue({
      success: true,
      messageId: "provider-message-1",
    });
    startEmailWorker();

    await processors[0]({
      id: "campaign-job-2",
      name: "campaign-email",
      data: {
        to: "client@example.com",
        toName: "Client",
        subject: "A campaign",
        htmlContent: "<p>Hello</p>",
        fromName: "Agency",
        campaignId: "campaign-1",
        clientId: "client-1",
        tenantId: "tenant-a",
      },
    });

    expect(mockSendReminderHtmlEmail).toHaveBeenCalledWith({
      to: "client@example.com",
      subject: "A campaign",
      html: "<p>Hello</p>",
      fromName: "Agency",
    });
    expect(updateWheres).toEqual([
      {
        conditions: [
          { column: "campaign_sends.id", value: "campaign-job-2" },
          { column: "campaign_sends.campaign_id", value: "campaign-1" },
          { column: "campaign_sends.client_id", value: "client-1" },
          { column: "campaign_sends.tenant_id", value: "tenant-a" },
        ],
      },
    ]);
  });

  it("tenant-scopes the campaign send update after exhausted retries", async () => {
    startEmailWorker();

    await failedHandlers[0](
      {
        id: "campaign-job-3",
        name: "campaign-email",
        attemptsMade: 3,
        opts: { attempts: 3 },
        data: {
          campaignId: "campaign-1",
          clientId: "client-1",
          tenantId: "tenant-a",
        },
      },
      new Error("Provider unavailable"),
    );

    expect(updateWheres).toEqual([
      {
        conditions: [
          { column: "campaign_sends.id", value: "campaign-job-3" },
          { column: "campaign_sends.campaign_id", value: "campaign-1" },
          { column: "campaign_sends.client_id", value: "client-1" },
          { column: "campaign_sends.tenant_id", value: "tenant-a" },
        ],
      },
    ]);
  });
});