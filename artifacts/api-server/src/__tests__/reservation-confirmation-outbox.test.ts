import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WhatsAppOutboxStatus } from "@workspace/db";

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

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
    attempts: "attempts",
    enqueuedAt: "enqueued_at",
    sentAt: "sent_at",
    lastError: "last_error",
    updatedAt: "updated_at",
  },
  platformSettingsTable: {
    id: "platform_setting_id",
    key: "key",
    value: "value",
    label: "label",
    updatedAt: "platform_setting_updated_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  lt: vi.fn(),
  min: vi.fn(() => "min"),
  count: vi.fn(() => "count"),
  not: vi.fn(() => "not"),
  or: vi.fn(),
  sql: vi.fn(() => "sql"),
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
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    info: vi.fn(),
  },
}));

import {
  scheduleReservationConfirmedWhatsApp,
  deliverReservationConfirmedWhatsApp,
  alertUnknownReservationConfirmations,
  retryPendingReservationConfirmedWhatsApps,
  resetStaleReservationConfirmedWhatsApps,
} from "../services/checkout/reservation-confirmation-outbox.js";

let insertResults: object[][] = [];
let selectResults: object[][] = [];
let platformSelectResults: object[][] = [];
let platformInsertResults: object[][] = [];
let platformUpdateResults: object[][] = [];
let platformSelectGate: Promise<void> | null = null;
let releasePlatformSelect: (() => void) | null = null;
let updates: Array<Record<string, unknown>> = [];
let platformUpdates: Array<Record<string, unknown>> = [];
/** Rows returned by .returning() on claim updates. One entry per claim attempt. */
let claimResults: object[][] = [];

function installDbMocks() {
  mockInsert.mockImplementation((table: unknown) => {
    const isPlatformSetting = typeof table === "object" && table !== null &&
      (table as { key?: unknown }).key === "key";
    return {
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(
            (isPlatformSetting ? platformInsertResults : insertResults).shift() ?? [],
          )),
        })),
      })),
    };
  });

  mockSelect.mockImplementation((selection: unknown) => {
    const isPlatformSetting = typeof selection === "object" && selection !== null &&
      "value" in selection && "updatedAt" in selection && !("tenantId" in selection);
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => {
      const rows = (isPlatformSetting ? platformSelectResults : selectResults).shift() ?? [];
      const result = Promise.resolve(rows) as Promise<object[]> & {
        limit: () => Promise<object[]>;
        groupBy: () => Promise<object[]>;
      };
      result.limit = vi.fn(() =>
        isPlatformSetting && platformSelectGate
          ? platformSelectGate.then(() => rows)
          : Promise.resolve(rows),
      );
      result.groupBy = vi.fn(() => Promise.resolve(rows));
      return result;
    });
    return chain;
  });

  mockUpdate.mockImplementation((table: unknown) => {
    const isPlatformSetting = typeof table === "object" && table !== null &&
      (table as { key?: unknown }).key === "key";
    const chain: Record<string, unknown> = {};
    chain.set = vi.fn((values: Record<string, unknown>) => {
      (isPlatformSetting ? platformUpdates : updates).push(values);
      return chain;
    });
    // .where() returns a thenable that also exposes .returning().
    // .returning() pops from claimResults only when called (for the atomic claim update).
    // Awaiting .where() directly resolves to undefined (for plain status updates).
    chain.where = vi.fn(() =>
      Object.assign(Promise.resolve(undefined), {
        returning: vi.fn(() => Promise.resolve(
          (isPlatformSetting ? platformUpdateResults : claimResults).shift() ?? [],
        )),
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
    platformSelectResults = [];
    platformInsertResults = [];
    platformUpdateResults = [];
    platformSelectGate = null;
    releasePlatformSelect = null;
    claimResults = [];
    updates = [];
    platformUpdates = [];
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
      [{ id: "outbox-1" }], // first delivery: failed status is released
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

  it("marks a stale processing claim unknown and does not deliver it on the next retry run", async () => {
    const outbox = {
      id: "outbox-1",
      tenantId: "tenant-1",
      reservationId: "res-1",
      sentAt: null,
    };
    insertResults = [[]]; // retry resumes the existing durable record
    selectResults = [
      [], // no unknown rows to alert
      [], // unknown rows are not eligible for automatic retry
    ];
    claimResults = [[{ id: outbox.id }]]; // stale processing → unknown

    await retryPendingReservationConfirmedWhatsApps();

    expect(mockDispatchReservationConfirmed).not.toHaveBeenCalled();
    expect(updates.map((update) => update.status)).toEqual(["unknown"]);
    expect(updates[0]).toMatchObject({
      status: "unknown",
      lastError: "delivery_result_unknown",
      updatedAt: expect.any(Date),
    });
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

  it("does not enqueue or deliver a confirmation whose provider result is unknown", async () => {
    insertResults = [[]];
    selectResults = [[{
      id: "outbox-1",
      sentAt: null,
      status: "unknown",
    }]];
    const add = vi.fn().mockResolvedValue(undefined);
    mockQueue.mockReturnValue({ add });

    await scheduleReservationConfirmedWhatsApp("res-1", "tenant-1");

    expect(add).not.toHaveBeenCalled();
    expect(mockDispatchReservationConfirmed).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("alerts once per agency with the count and age of unknown confirmations", async () => {
    const oldestAt = new Date(Date.now() - 23 * 60_000);
    selectResults = [[
      { tenantId: "tenant-1", unknownCount: 3, oldestAt },
      { tenantId: "tenant-2", unknownCount: "2", oldestAt: new Date(Date.now() - 61 * 60_000) },
    ]];
    platformSelectResults = [[], []];
    platformInsertResults = [[{ id: "alert-state-1" }], [{ id: "alert-state-2" }]];

    await alertUnknownReservationConfirmations();

    expect(mockLoggerWarn).toHaveBeenCalledTimes(2);
    expect(mockLoggerWarn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tenantId: "tenant-1",
        unknownCount: 3,
        oldestAt,
        ageMinutes: expect.any(Number),
      }),
      "[whatsapp-outbox] Unknown reservation confirmations require manual review",
    );
    expect(mockLoggerWarn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        tenantId: "tenant-2",
        unknownCount: 2,
        oldestAt: expect.any(Date),
        ageMinutes: expect.any(Number),
      }),
      "[whatsapp-outbox] Unknown reservation confirmations require manual review",
    );
  });

  it("suppresses a repeated alert within the persisted cooldown window", async () => {
    const now = Date.now();
    selectResults = [[{
      tenantId: "tenant-1",
      unknownCount: 3,
      oldestAt: new Date(now - 23 * 60_000),
    }]];
    platformSelectResults = [[{
      value: JSON.stringify({ lastAlertAt: now - 5 * 60_000, lastCount: 3, lastAgeMinutes: 23 }),
      updatedAt: new Date(now - 5 * 60_000),
    }]];

    await alertUnknownReservationConfirmations();

    expect(mockLoggerWarn).not.toHaveBeenCalled();
    expect(platformUpdates).toEqual([]);
  });

  it.each([
    ["count increases", 4, 23],
    ["age reaches the next hour", 3, 83],
  ])("allows a new alert when %s", async (_reason, unknownCount, ageMinutes) => {
    const now = Date.now();
    selectResults = [[{
      tenantId: "tenant-1",
      unknownCount,
      oldestAt: new Date(now - ageMinutes * 60_000),
    }]];
    const storedAt = new Date(now - 5 * 60_000);
    platformSelectResults = [[{
      value: JSON.stringify({ lastAlertAt: now - 5 * 60_000, lastCount: 3, lastAgeMinutes: 23 }),
      updatedAt: storedAt,
    }]];
    platformUpdateResults = [[{ id: "alert-state-1" }]];

    await alertUnknownReservationConfirmations();

    expect(mockLoggerWarn).toHaveBeenCalledOnce();
    expect(platformUpdates).toContainEqual(expect.objectContaining({
      value: expect.stringContaining(`"lastCount":${unknownCount}`),
    }));
  });

  it("emits only one alert when concurrent workers lose the same CAS race", async () => {
    const now = Date.now();
    const oldestAt = new Date(now - 23 * 60_000);
    const storedAt = new Date(now - 5 * 60_000);
    const storedState = {
      value: JSON.stringify({ lastAlertAt: now - 2 * 60_000, lastCount: 3, lastAgeMinutes: 23 }),
      updatedAt: storedAt,
    };
    selectResults = [[
      { tenantId: "tenant-1", unknownCount: 4, oldestAt },
    ], [
      { tenantId: "tenant-1", unknownCount: 4, oldestAt },
    ]];
    platformSelectResults = [[storedState], [storedState]];
    platformUpdateResults = [[{ id: "alert-state-1" }], []];
    platformSelectGate = new Promise<void>((resolve) => {
      releasePlatformSelect = resolve;
    });

    const firstAlert = alertUnknownReservationConfirmations();
    const secondAlert = alertUnknownReservationConfirmations();
    for (let attempt = 0; attempt < 10 && mockSelect.mock.calls.length < 4; attempt++) {
      await Promise.resolve();
    }
    expect(mockSelect).toHaveBeenCalledTimes(4);
    releasePlatformSelect?.();
    platformSelectGate = null;
    await Promise.all([firstAlert, secondAlert]);

    expect(platformUpdates).toHaveLength(2);
    expect(mockLoggerWarn).toHaveBeenCalledOnce();
  });

  it("marks processing rows older than 15 minutes as unknown and logs the count", async () => {
    claimResults = [[{ id: "stuck-outbox-1" }]];

    const resetCount = await resetStaleReservationConfirmedWhatsApps();

    expect(resetCount).toBe(1);
    expect(updates).toContainEqual({
      status: "unknown",
      lastError: "delivery_result_unknown",
      updatedAt: expect.any(Date),
    });
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1, staleBefore: expect.any(Date) }),
      "[whatsapp-outbox] Marked stale processing rows as unknown",
    );
  });

  it("does not log when no processing rows are stale", async () => {
    claimResults = [[]];

    const resetCount = await resetStaleReservationConfirmedWhatsApps();

    expect(resetCount).toBe(0);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it("keeps every production outbox status type-safe", () => {
    const productionStatuses: WhatsAppOutboxStatus[] = [
      "pending",
      "enqueued",
      "processing",
      "sent",
      "unknown",
    ];

    expect(productionStatuses).toContain("processing");
  });
});
