import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
  whatsappNotificationOutboxTable: {
    id: "id",
    tenantId: "tenant_id",
    reservationId: "reservation_id",
    type: "type",
    status: "status",
    enqueuedAt: "enqueued_at",
    sentAt: "sent_at",
    lastError: "last_error",
    updatedAt: "updated_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  lt: vi.fn(),
  not: vi.fn(() => "not"),
  or: vi.fn(),
}));

const mockGenerateId = vi.fn(() => "outbox-1");
vi.mock("../lib/id.js", () => ({ generateId: () => mockGenerateId() }));

const mockQueue = vi.fn();
vi.mock("../queues/index.js", () => ({
  getWhatsAppQueue: () => mockQueue(),
}));

const mockDispatchReservationConfirmed = vi.fn();
vi.mock("../queues/whatsapp-helpers.js", () => ({
  dispatchWhatsAppReservationConfirmed: (...args: unknown[]) =>
    mockDispatchReservationConfirmed(...args),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { warn: (...args: unknown[]) => mockLoggerWarn(...args), info: vi.fn() },
}));

import {
  scheduleReservationConfirmedWhatsApp,
  resetStaleReservationConfirmedWhatsApps,
} from "../services/checkout/reservation-confirmation-outbox.js";

let insertResults: object[][] = [];
let selectResults: object[][] = [];
let updates: Array<Record<string, unknown>> = [];
/** Rows returned by .returning() on claim updates. One entry per claim attempt. */
let claimResults: object[][] = [];

function installDbMocks() {
  mockInsert.mockImplementation(() => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(insertResults.shift() ?? [])),
      })),
    })),
  }));

  mockSelect.mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => {
      const rows = selectResults.shift() ?? [];
      const result = Promise.resolve(rows) as Promise<object[]> & {
        limit: () => Promise<object[]>;
      };
      result.limit = vi.fn(() => Promise.resolve(rows));
      return result;
    });
    return chain;
  });

  mockUpdate.mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    chain.set = vi.fn((values: Record<string, unknown>) => {
      updates.push(values);
      return chain;
    });
    // .where() returns a thenable that also exposes .returning().
    // .returning() pops from claimResults only when called (for the atomic claim update).
    // Awaiting .where() directly resolves to undefined (for plain status updates).
    chain.where = vi.fn(() =>
      Object.assign(Promise.resolve(undefined), {
        returning: vi.fn(() => Promise.resolve(claimResults.shift() ?? [])),
      }),
    );
    return chain;
  });
}

describe("reservation confirmation WhatsApp outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertResults = [];
    selectResults = [];
    claimResults = [];
    updates = [];
    mockQueue.mockReturnValue(null);
    mockDispatchReservationConfirmed.mockResolvedValue(true);
    installDbMocks();
  });

  it("keeps a failed direct delivery pending, retries it, and never delivers again after success", async () => {
    const pending = { id: "outbox-1", tenantId: "tenant-1", reservationId: "res-1", sentAt: null };
    const sent = { ...pending, sentAt: new Date() };

    insertResults = [
      [{ id: "outbox-1", sentAt: null }], // first payment creates the durable record
      [], // balance-payment retry finds that same record
      [], // any later retry still finds the same record
    ];
    selectResults = [
      [pending], // first direct delivery — select by id
      [{ id: "outbox-1", sentAt: null }], // retry locates existing record (no sentAt)
      [pending], // retry delivers it — select by id
      [{ id: "outbox-1", sentAt: sent.sentAt }], // third call — existing record already sent
    ];
    // Each direct delivery attempt atomically claims the row first.
    claimResults = [
      [{ id: "outbox-1" }], // first delivery: claim succeeds
      [{ id: "outbox-1" }], // second delivery: claim succeeds
    ];
    mockDispatchReservationConfirmed
      .mockResolvedValueOnce(false) // provider/dispatcher failure
      .mockResolvedValueOnce(true); // retry succeeds

    await scheduleReservationConfirmedWhatsApp("res-1", "tenant-1");
    await scheduleReservationConfirmedWhatsApp("res-1", "tenant-1");
    await scheduleReservationConfirmedWhatsApp("res-1", "tenant-1");

    expect(mockDispatchReservationConfirmed).toHaveBeenCalledTimes(2);
    expect(mockDispatchReservationConfirmed).toHaveBeenNthCalledWith(1, {
      reservationId: "res-1",
      tenantId: "tenant-1",
      delivery: "direct",
    });
    expect(mockDispatchReservationConfirmed).toHaveBeenNthCalledWith(2, {
      reservationId: "res-1",
      tenantId: "tenant-1",
      delivery: "direct",
    });
    expect(updates).toContainEqual(expect.objectContaining({ status: "pending", lastError: "delivery_failed" }));
    expect(updates).toContainEqual(expect.objectContaining({ status: "processing", updatedAt: expect.any(Date) }));
    expect(updates).toContainEqual(expect.objectContaining({ status: "sent", sentAt: expect.any(Date) }));
  });

  it("skips delivery when another worker already holds the processing claim", async () => {
    const pending = { id: "outbox-1", tenantId: "tenant-1", reservationId: "res-1", sentAt: null };

    insertResults = [[{ id: "outbox-1", sentAt: null }]];
    selectResults = [[pending]];
    // Claim update returns 0 rows → row already claimed by another worker
    claimResults = [[]];

    await scheduleReservationConfirmedWhatsApp("res-1", "tenant-1");

    // No dispatch because the claim was lost
    expect(mockDispatchReservationConfirmed).not.toHaveBeenCalled();
    // No sent/pending status update either — the other worker will handle completion
    expect(updates).not.toContainEqual(expect.objectContaining({ status: "sent" }));
    expect(updates).not.toContainEqual(expect.objectContaining({ status: "pending" }));
  });

  it("uses one deterministic queue job for repeated payment-side-effect calls", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    mockQueue.mockReturnValue({ add });
    insertResults = [
      [{ id: "outbox-1", sentAt: null }],
      [],
    ];
    selectResults = [
      [{ id: "outbox-1", sentAt: null }],
    ];

    await scheduleReservationConfirmedWhatsApp("res-1", "tenant-1");
    await scheduleReservationConfirmedWhatsApp("res-1", "tenant-1");

    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenNthCalledWith(
      1,
      "reservation-confirmed",
      { kind: "reservation-confirmed", outboxId: "outbox-1" },
      { jobId: "reservation-confirmed:outbox-1" },
    );
    expect(add).toHaveBeenNthCalledWith(
      2,
      "reservation-confirmed",
      { kind: "reservation-confirmed", outboxId: "outbox-1" },
      { jobId: "reservation-confirmed:outbox-1" },
    );
    expect(mockDispatchReservationConfirmed).not.toHaveBeenCalled();
  });

  it("resets processing rows older than 15 minutes and logs the recovered count", async () => {
    claimResults = [[{ id: "stuck-outbox-1" }]];

    const resetCount = await resetStaleReservationConfirmedWhatsApps();

    expect(resetCount).toBe(1);
    expect(updates).toContainEqual({
      status: "pending",
      lastError: "processing_timeout",
      updatedAt: expect.any(Date),
    });
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1, staleBefore: expect.any(Date) }),
      "[whatsapp-outbox] Reset stale processing rows for retry",
    );
  });

  it("does not log when no processing rows are stale", async () => {
    claimResults = [[]];

    const resetCount = await resetStaleReservationConfirmedWhatsApps();

    expect(resetCount).toBe(0);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });
});