import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSelect,
  mockUpdate,
  mockSendReservationConfirmationEmail,
  mockWorker,
  mockAnd,
  mockEq,
  processors,
  updateWheres,
} = vi.hoisted(() => {
  const processors: Array<(job: unknown) => Promise<unknown>> = [];
  const updateWheres: unknown[] = [];
  const set = vi.fn(() => ({
    where: vi.fn((condition: unknown) => {
      updateWheres.push(condition);
      return Promise.resolve();
    }),
  }));

  return {
    mockSelect: vi.fn(),
    mockUpdate: vi.fn(() => ({ set })),
    mockSendReservationConfirmationEmail: vi.fn(),
    mockWorker: vi.fn().mockImplementation((_queue, processor) => {
      processors.push(processor);
      return { on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
    }),
    mockAnd: vi.fn((...conditions: unknown[]) => ({ conditions })),
    mockEq: vi.fn((column, value) => ({ column, value })),
    processors,
    updateWheres,
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
  campaignSendsTable: {},
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
  sendReminderHtmlEmail: vi.fn(),
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
    updateWheres.length = 0;
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
    expect(updateWheres).toEqual([
      {
        conditions: [
          { column: "email_logs.id", value: "log-1" },
          { column: "email_logs.tenant_id", value: "tenant-a" },
        ],
      },
    ]);
  });
});