import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Thenable helper ──────────────────────────────────────────────────────────
// Drizzle query chains are awaitable directly (.where()) or via .limit().
// This helper returns an object that satisfies both patterns.

function makeWhereNode(data: unknown[]) {
  const resolved = Promise.resolve(data);
  return {
    limit: vi.fn().mockResolvedValue(data),
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };
}

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockBuildEmailProps,
  mockSendReservationConfirmationEmail,
  mockSendReminderHtmlEmail,
  mockGenerateId,
  mockLogInfo,
  mockLogWarn,
  mockLogError,
  mockLogDebug,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockBuildEmailProps: vi.fn(),
  mockSendReservationConfirmationEmail: vi.fn(),
  mockSendReminderHtmlEmail: vi.fn(),
  mockGenerateId: vi.fn(() => "generated-id"),
  mockLogInfo: vi.fn(),
  mockLogWarn: vi.fn(),
  mockLogError: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  },
  emailLogsTable: {
    id: "id",
    tenantId: "tenantId",
    reservationId: "reservationId",
    status: "status",
    isAutoRetry: "isAutoRetry",
    subject: "subject",
    createdAt: "createdAt",
    recipient: "recipient",
    messageId: "messageId",
    errorMessage: "errorMessage",
  },
  reservationsTable: { id: "id", tenantId: "tenantId", clientId: "clientId", tripId: "tripId", reservationNumber: "reservationNumber", voucherCode: "voucherCode" },
  clientsTable: { id: "id", email: "email", name: "name" },
  tripsTable: { id: "id", name: "name", destination: "destination" },
  tenantsTable: { id: "id", name: "name" },
  storesTable: { id: "id", tenantId: "tenantId", email: "email" },
  usersTable: { id: "id", tenantId: "tenantId", email: "email", role: "role", isActive: "isActive" },
  paymentsTable: { id: "id", status: "status", type: "type", dueDate: "dueDate", paidAt: "paidAt", amount: "amount", reservationId: "reservationId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col, val) => `eq:${String(val)}`),
  and: vi.fn((...args: unknown[]) => `and(${args.join(",")})`),
  gt: vi.fn(),
  sql: vi.fn(),
  gte: vi.fn(),
  lt: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  notLike: vi.fn((_col, pat) => `notLike:${String(pat)}`),
  like: vi.fn((_col, pat) => `like:${String(pat)}`),
  inArray: vi.fn(),
}));

vi.mock("@workspace/email", () => ({
  sendReservationConfirmationEmail: mockSendReservationConfirmationEmail,
  sendReminderHtmlEmail: mockSendReminderHtmlEmail,
}));

vi.mock("../queues/email-helpers.js", () => ({
  buildEmailPropsFromReservation: mockBuildEmailProps,
}));

vi.mock("../lib/id.js", () => ({
  generateId: mockGenerateId,
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: mockLogInfo,
    warn: mockLogWarn,
    error: mockLogError,
    debug: mockLogDebug,
  },
}));

vi.mock("../lib/email-retry-constants.js", () => ({
  MAX_AUTO_RETRY_ATTEMPTS: 3,
}));

vi.mock("bullmq", () => ({ Worker: vi.fn() }));
vi.mock("../lib/redis.js", () => ({ getRedisConnection: vi.fn(() => null) }));
vi.mock("../lib/expired-reservations.js", () => ({ runExpiredReservationsCron: vi.fn() }));
vi.mock("../queues/index.js", () => ({}));
vi.mock("@workspace/permissions", () => ({
  RESERVATION_STATUS: { CONFIRMED: "confirmed" },
  PAYMENT_STATUS: { PENDING: "pending" },
  ROLES: { AGENCY_ADMIN: "agency_admin", AGENCY_MANAGER: "agency_manager" },
}));

import { retryFailedBookingEmails } from "./reminder.worker.js";

// ─── Test setup helpers ───────────────────────────────────────────────────────

function setupSelectQueue(responses: unknown[][]) {
  let callCount = 0;
  mockDbSelect.mockImplementation(() => {
    const data = responses[callCount++] ?? [];
    const chain: Record<string, unknown> = {};
    chain["from"] = vi.fn(() => chain);
    chain["innerJoin"] = vi.fn(() => chain);
    chain["where"] = vi.fn(() => makeWhereNode(data));
    chain["limit"] = vi.fn().mockResolvedValue(data);
    return chain;
  });
}

function setupInsertMock() {
  mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
}

function setupUpdateMock() {
  mockDbUpdate.mockReturnValue({
    set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
  });
}

const RESERVATION_ID = "res-001";
const TENANT_ID = "tenant-001";

const failedLog = {
  id: "log-001",
  tenantId: TENANT_ID,
  reservationId: RESERVATION_ID,
  subject: "Confirmação de Reserva",
};

const emailProps = {
  clientEmail: "client@example.com",
  clientName: "Test Client",
  reservationId: RESERVATION_ID,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("retryFailedBookingEmails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupInsertMock();
    setupUpdateMock();
    mockGenerateId.mockReturnValue("new-log-id");
  });

  // ── Early exit ────────────────────────────────────────────────────────────

  it("does nothing when there are no failed emails in the last 2 hours", async () => {
    setupSelectQueue([[]]);

    await retryFailedBookingEmails();

    expect(mockBuildEmailProps).not.toHaveBeenCalled();
    expect(mockSendReservationConfirmationEmail).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(
      expect.stringContaining("No failed booking"),
    );
  });

  // ── Already-delivered skip ─────────────────────────────────────────────────

  it("skips a reservation when a successful send already exists in the window", async () => {
    setupSelectQueue([
      [failedLog],
      [{ status: "sent", isAutoRetry: false }],
    ]);

    await retryFailedBookingEmails();

    expect(mockBuildEmailProps).not.toHaveBeenCalled();
    expect(mockSendReservationConfirmationEmail).not.toHaveBeenCalled();
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: RESERVATION_ID }),
      expect.stringContaining("successful send already exists"),
    );
  });

  it("skips even when the successful send was a manual resend (isAutoRetry=false)", async () => {
    setupSelectQueue([
      [failedLog],
      [
        { status: "failed", isAutoRetry: false },
        { status: "sent", isAutoRetry: false },
      ],
    ]);

    await retryFailedBookingEmails();

    expect(mockSendReservationConfirmationEmail).not.toHaveBeenCalled();
  });

  // ── Max auto-retry ceiling ─────────────────────────────────────────────────

  it("skips and warns when 3 auto-retries (isAutoRetry=true) have already been attempted", async () => {
    setupSelectQueue([
      [failedLog],
      [
        { status: "failed", isAutoRetry: true },
        { status: "failed", isAutoRetry: true },
        { status: "failed", isAutoRetry: true },
      ],
      // notifyStaffOfExhaustedRetries — existing successful alert → short-circuit
      [{ id: "existing-alert" }],
    ]);

    await retryFailedBookingEmails();

    expect(mockBuildEmailProps).not.toHaveBeenCalled();
    expect(mockSendReservationConfirmationEmail).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: RESERVATION_ID,
        autoRetriesDone: 3,
        limit: 3,
      }),
      expect.stringContaining("max auto-retry limit"),
    );
  });

  // ── Manual resends must NOT inflate the auto-retry counter ────────────────

  it("does not count manual resends (isAutoRetry=false) toward the 3-attempt ceiling", async () => {
    setupSelectQueue([
      [failedLog],
      [
        { status: "failed", isAutoRetry: false },
        { status: "failed", isAutoRetry: false },
        { status: "failed", isAutoRetry: false },
      ],
    ]);

    mockBuildEmailProps.mockResolvedValue(emailProps);
    mockSendReservationConfirmationEmail.mockResolvedValue({ success: true, messageId: "msg-001" });

    await retryFailedBookingEmails();

    // autoRetriesDone = 0 (all entries are manual), so the retry must proceed
    expect(mockBuildEmailProps).toHaveBeenCalledWith(RESERVATION_ID, TENANT_ID);
    expect(mockSendReservationConfirmationEmail).toHaveBeenCalledOnce();
  });

  it("retries when 2 auto-retries are done and ceiling is 3", async () => {
    setupSelectQueue([
      [failedLog],
      [
        { status: "failed", isAutoRetry: false },
        { status: "failed", isAutoRetry: true },
        { status: "failed", isAutoRetry: true },
      ],
    ]);

    mockBuildEmailProps.mockResolvedValue(emailProps);
    mockSendReservationConfirmationEmail.mockResolvedValue({ success: true, messageId: "msg-002" });

    await retryFailedBookingEmails();

    // autoRetriesDone = 2 < 3, so retry must proceed
    expect(mockBuildEmailProps).toHaveBeenCalledWith(RESERVATION_ID, TENANT_ID);
    expect(mockSendReservationConfirmationEmail).toHaveBeenCalledOnce();
  });

  it("respects the ceiling exactly: 3 auto + any manual = skipped, 2 auto + any manual = retried", async () => {
    // Setup first call: 3 auto + 2 manual (should skip)
    // Setup second call: 2 auto + 5 manual (should retry)
    const res2Id = "res-002";
    const failedLog2 = { id: "log-002", tenantId: TENANT_ID, reservationId: res2Id, subject: "Confirmação" };

    setupSelectQueue([
      [failedLog, failedLog2],
      // windowLogs for res-001: 3 auto + 1 manual → skip
      [
        { status: "failed", isAutoRetry: false },
        { status: "failed", isAutoRetry: true },
        { status: "failed", isAutoRetry: true },
        { status: "failed", isAutoRetry: true },
      ],
      // notifyStaff check for res-001: existing alert found → skip sending alert
      [{ id: "existing-alert" }],
      // windowLogs for res-002: 2 auto + 5 manual → retry
      [
        { status: "failed", isAutoRetry: false },
        { status: "failed", isAutoRetry: false },
        { status: "failed", isAutoRetry: false },
        { status: "failed", isAutoRetry: false },
        { status: "failed", isAutoRetry: false },
        { status: "failed", isAutoRetry: true },
        { status: "failed", isAutoRetry: true },
      ],
    ]);

    mockBuildEmailProps.mockResolvedValue({ ...emailProps, reservationId: res2Id });
    mockSendReservationConfirmationEmail.mockResolvedValue({ success: true, messageId: "msg-003" });

    await retryFailedBookingEmails();

    // Only res-002 should be retried
    expect(mockBuildEmailProps).toHaveBeenCalledTimes(1);
    expect(mockBuildEmailProps).toHaveBeenCalledWith(res2Id, TENANT_ID);
    expect(mockSendReservationConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  // ── Successful retry ──────────────────────────────────────────────────────

  it("inserts a new email log with isAutoRetry=true before sending", async () => {
    setupSelectQueue([
      [failedLog],
      [{ status: "failed", isAutoRetry: false }],
    ]);

    const insertValuesMock = vi.fn().mockResolvedValue([]);
    mockDbInsert.mockReturnValue({ values: insertValuesMock });

    mockBuildEmailProps.mockResolvedValue(emailProps);
    mockSendReservationConfirmationEmail.mockResolvedValue({ success: true, messageId: "mid" });

    await retryFailedBookingEmails();

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isAutoRetry: true,
        reservationId: RESERVATION_ID,
        tenantId: TENANT_ID,
        status: "queued",
      }),
    );
  });

  it("marks the new log as sent when the retry email succeeds", async () => {
    setupSelectQueue([
      [failedLog],
      [{ status: "failed", isAutoRetry: false }],
    ]);

    const setMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) }));
    mockDbUpdate.mockReturnValue({ set: setMock });

    mockBuildEmailProps.mockResolvedValue(emailProps);
    mockSendReservationConfirmationEmail.mockResolvedValue({ success: true, messageId: "msg-sent" });

    await retryFailedBookingEmails();

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent", messageId: "msg-sent" }),
    );
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: RESERVATION_ID }),
      expect.stringContaining("Auto-retry sent successfully"),
    );
  });

  // ── Failed retry ──────────────────────────────────────────────────────────

  it("marks the new log as failed when the retry email send fails", async () => {
    setupSelectQueue([
      [failedLog],
      [{ status: "failed", isAutoRetry: false }],
    ]);

    const setMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) }));
    mockDbUpdate.mockReturnValue({ set: setMock });

    mockBuildEmailProps.mockResolvedValue(emailProps);
    mockSendReservationConfirmationEmail.mockResolvedValue({ success: false, error: "SMTP timeout" });

    await retryFailedBookingEmails();

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorMessage: "SMTP timeout" }),
    );
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: RESERVATION_ID }),
      expect.stringContaining("Auto-retry send failed"),
    );
  });

  // ── Guard: missing email props ─────────────────────────────────────────────

  it("skips the retry without sending when email props cannot be rebuilt", async () => {
    setupSelectQueue([
      [failedLog],
      [{ status: "failed", isAutoRetry: false }],
    ]);

    mockBuildEmailProps.mockResolvedValue(null);

    await retryFailedBookingEmails();

    expect(mockSendReservationConfirmationEmail).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: RESERVATION_ID }),
      expect.stringContaining("Cannot rebuild email props"),
    );
  });

  // ── Deduplication ─────────────────────────────────────────────────────────

  it("processes each reservation only once even if multiple failed log rows exist for it", async () => {
    setupSelectQueue([
      [
        { ...failedLog, id: "log-001" },
        { ...failedLog, id: "log-002" },
        { ...failedLog, id: "log-003" },
      ],
      [{ status: "failed", isAutoRetry: false }],
    ]);

    mockBuildEmailProps.mockResolvedValue(emailProps);
    mockSendReservationConfirmationEmail.mockResolvedValue({ success: true, messageId: "mid" });

    await retryFailedBookingEmails();

    expect(mockBuildEmailProps).toHaveBeenCalledTimes(1);
    expect(mockSendReservationConfirmationEmail).toHaveBeenCalledTimes(1);
  });
});

// ─── notifyStaffOfExhaustedRetries (via exhaustion path) ──────────────────────
//
// These tests (#116 / #117) exercise the staff-alert helper by triggering the
// exhaustion branch inside retryFailedBookingEmails (autoRetriesDone >= 3).
// Each test sets up the db.select call sequence expected by the full call chain:
//   1. failed logs fetch
//   2. window logs (3 auto-retries → exhaustion triggered)
//   3. dedup check (existing successful staff alert?)
//   4. reservation + client + trip + tenant details
//   5. store email
//   6. agency staff users

describe("notifyStaffOfExhaustedRetries (via exhaustion path)", () => {
  const reservationRow = {
    reservationNumber: "001",
    voucherCode: "V001",
    clientName: "Ana Lima",
    clientEmail: "ana@example.com",
    tripName: "Gramado 2025",
    tripDestination: "Gramado",
    agencyName: "Agência Sol",
  };

  const threeAutoRetries = [
    { status: "failed", isAutoRetry: true },
    { status: "failed", isAutoRetry: true },
    { status: "failed", isAutoRetry: true },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    setupInsertMock();
    setupUpdateMock();
    mockGenerateId.mockReturnValue("alert-log-id");
  });

  // #116 — sends the staff alert email when retries are exhausted

  it("sends a staff alert email to store and admin recipients when retries are exhausted", async () => {
    setupSelectQueue([
      [failedLog],
      threeAutoRetries,
      [],                              // dedup: no existing sent staff alert
      [reservationRow],               // reservation details
      [{ email: "store@agency.com" }], // store email
      [{ email: "admin@agency.com" }], // staff users
    ]);

    mockSendReminderHtmlEmail.mockResolvedValue({ success: true, messageId: "alert-mid" });

    await retryFailedBookingEmails();

    expect(mockSendReminderHtmlEmail).toHaveBeenCalledTimes(2);
    expect(mockSendReminderHtmlEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "store@agency.com" }),
    );
    expect(mockSendReminderHtmlEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@agency.com" }),
    );
  });

  it("inserts an email log row for the staff alert before sending", async () => {
    setupSelectQueue([
      [failedLog],
      threeAutoRetries,
      [],
      [reservationRow],
      [{ email: "store@agency.com" }],
      [],
    ]);

    mockSendReminderHtmlEmail.mockResolvedValue({ success: true, messageId: "mid" });

    await retryFailedBookingEmails();

    const insertValues = mockDbInsert.mock.calls[0];
    expect(insertValues).toBeDefined();
  });

  // #117 — deduplication: send-once behavior

  it("does NOT send a staff alert if a successful alert was already sent for this reservation", async () => {
    setupSelectQueue([
      [failedLog],
      threeAutoRetries,
      [{ id: "existing-alert-log" }],  // dedup: existing sent staff alert
    ]);

    await retryFailedBookingEmails();

    expect(mockSendReminderHtmlEmail).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: RESERVATION_ID }),
      expect.stringContaining("Staff alert already successfully sent"),
    );
  });

  it("does NOT send a staff alert when no email recipients are configured", async () => {
    setupSelectQueue([
      [failedLog],
      threeAutoRetries,
      [],              // dedup: no existing alert
      [reservationRow],
      [],              // no store email
      [],              // no staff users
    ]);

    await retryFailedBookingEmails();

    expect(mockSendReminderHtmlEmail).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: RESERVATION_ID }),
      expect.stringContaining("No staff recipients"),
    );
  });

  it("skips the staff alert when reservation details cannot be fetched", async () => {
    setupSelectQueue([
      [failedLog],
      threeAutoRetries,
      [],   // dedup: no existing alert
      [],   // reservation details not found
    ]);

    await retryFailedBookingEmails();

    expect(mockSendReminderHtmlEmail).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: RESERVATION_ID }),
      expect.stringContaining("Cannot fetch reservation for staff alert"),
    );
  });
});
