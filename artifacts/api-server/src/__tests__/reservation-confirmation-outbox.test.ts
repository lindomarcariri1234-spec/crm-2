import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();

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
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
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
  logger: { warn: vi.fn() },
}));

import {
  scheduleReservationConfirmedWhatsApp,
} from "../services/checkout/reservation-confirmation-outbox.js";

let insertResults: object[][] = [];
let selectResults: object[][] = [];
let updates: Array<Record<string, unknown>> = [];

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
    chain.where = vi.fn(() => Promise.resolve());
    return chain;
  });
}

describe("reservation confirmation WhatsApp outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertResults = [];
    selectResults = [];
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
      [pending], // first direct delivery
      [{ id: "outbox-1", sentAt: null }], // retry locates existing record
      [pending], // retry delivers it
      [{ id: "outbox-1", sentAt: sent.sentAt }], // delivered record is a no-op
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
    expect(updates).toContainEqual(expect.objectContaining({ status: "sent", sentAt: expect.any(Date) }));
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
});