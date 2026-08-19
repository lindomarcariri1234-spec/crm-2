/**
 * Unit tests for the WhatsApp broadcast helpers introduced in Task #248.
 *
 * broadcastToReservationPassengers is a private function, so all scenarios
 * are exercised through the public dispatchers that call it:
 *   - dispatchWhatsAppReservationConfirmed  (primary broadcast vehicle)
 *   - dispatchWhatsAppCadastroRealizado     (toggle + broadcast)
 *   - dispatchWhatsAppPagamentoPendente     (toggle + broadcast)
 *   - dispatchWhatsAppBoardingReminder      (own inline loop with bp resolution)
 *
 * Key invariants verified:
 *   - Multiple passengers with unique phones each get one message
 *   - Duplicate normalized phones are deduplicated (one send)
 *   - Passenger's own phone is always used (ignores client whatsappOptIn)
 *   - Client phone is used as fallback ONLY when whatsappOptIn !== false
 *   - Zero-passenger fallback respects client opt-out
 *   - Enabled/disabled toggle silences the dispatcher completely
 *   - Boarding reminder resolves per-passenger boarding location from bpMap
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted state (must exist before any vi.mock factory runs) ───────────────

const { getQueue, setQueue, mockSendWhatsApp, mockInterpolate, mockDb } = vi.hoisted(() => {
  // Shared select queue — tests populate this before each assertion.
  const queue: unknown[][] = [];

  // Build a drizzle-like chain that pops the next row-set on .limit() or direct await.
  function makeChain(): Record<string, unknown> {
    const rows = queue.shift() ?? [];
    const chain: Record<string, unknown> = {};
    chain.from      = vi.fn(() => chain);
    chain.where     = vi.fn(() => chain);
    chain.innerJoin = vi.fn(() => chain);
    chain.limit     = vi.fn(() => Promise.resolve(rows));
    // Make the chain itself thenable so `await chain` works (no .limit() case).
    chain.then = (
      resolve: (v: unknown[]) => unknown,
      reject:  (e: unknown)   => unknown,
    ) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  }

  const mockDb = {
    select: vi.fn(() => makeChain()),
  };

  const mockSendWhatsApp = vi.fn().mockResolvedValue({ success: true });

  // Capture variables so tests can assert message content in boarding tests.
  const mockInterpolate = vi.fn(
    (_template: string, vars: Record<string, string>) => JSON.stringify(vars),
  );

  return {
    getQueue:  () => queue,
    setQueue:  (rows: unknown[][]) => { queue.length = 0; queue.push(...rows); },
    mockDb,
    mockSendWhatsApp,
    mockInterpolate,
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: mockDb,
  systemConfigsTable:  {},
  passengersTable:     {},
  reservationsTable:   {},
  clientsTable:        {},
  tripsTable:          {},
  tenantsTable:        {},
  referralSettingsTable: {},
  referralsTable:      {},
}));

vi.mock("drizzle-orm", () => ({
  eq:         vi.fn(() => "eq"),
  and:        vi.fn((...a: unknown[]) => a),
  desc:       vi.fn(() => "desc"),
  gte:        vi.fn(() => "gte"),
  lt:         vi.fn(() => "lt"),
  lte:        vi.fn(() => "lte"),
  gt:         vi.fn(() => "gt"),
  isNull:     vi.fn(() => "isNull"),
  isNotNull:  vi.fn(() => "isNotNull"),
  inArray:    vi.fn(() => "inArray"),
  sql:        Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
}));

vi.mock("../lib/whatsapp.js", () => ({
  sendTenantWhatsAppMessage: mockSendWhatsApp,
  interpolateWhatsAppMessage: mockInterpolate,
}));

// No BullMQ queue → enqueueOrSend falls through to direct sendTenantWhatsAppMessage.
vi.mock("../queues/index.js", () => ({
  getWhatsAppQueue: vi.fn().mockReturnValue(null),
}));

vi.mock("../lib/redis.js", () => ({
  areWorkersEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

// ─── Imports (after all mocks) ─────────────────────────────────────────────────

import {
  dispatchWhatsAppReservationConfirmed,
  dispatchWhatsAppCadastroRealizado,
  dispatchWhatsAppPagamentoPendente,
  dispatchWhatsAppBoardingReminder,
} from "../queues/whatsapp-helpers.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Defaults row: returns DEFAULT_NOTIFICATION_SETTINGS (reservationConfirmed=true). */
const SETTINGS_DEFAULT: unknown[] = [];

/** Settings enabling cadastroRealizado. */
const SETTINGS_CADASTRO_ON = [{ value: { cadastroRealizado: true } }];

/** Settings enabling pagamentoPendente. */
const SETTINGS_PAGAMENTO_ON = [{ value: { pagamentoPendente: true } }];

const TRIP_ROW = {
  tripName: "Litoral Norte",
  departureDate: null,
  reservationNumber: "R-001",
  voucherCode: null,
  tenantName: "Agência Teste",
};

const RESERVATION_CLIENT = { clientId: "client-1" };

const CLIENT_OPTED_IN = {
  whatsapp: "+5511999990001",
  phone: null,
  name: "João Silva",
  whatsappOptIn: true,
};

const CLIENT_OPTED_OUT = {
  whatsapp: "+5511999990001",
  phone: null,
  name: "João Silva",
  whatsappOptIn: false,
};

const PASSENGER_A = { id: "p1", name: "Alice", phone: "+5511888880001" };
const PASSENGER_B = { id: "p2", name: "Bob",   phone: "+5511888880002" };
/** Same normalized phone as CLIENT_OPTED_IN */
const PASSENGER_SAME_AS_CLIENT = { id: "p3", name: "Carlos", phone: "+5511999990001" };
/** Passenger with no own phone — will need client fallback */
const PASSENGER_NO_PHONE = { id: "p4", name: "Diana", phone: null };

// ─── Helpers ──────────────────────────────────────────────────────────────────

// sendTenantWhatsAppMessage(tenantId, phone, message) — phone is arg[1], message is arg[2]
function sentPhones(): string[] {
  return mockSendWhatsApp.mock.calls.map((c) => c[1] as string);
}
function sentMessages(): string[] {
  return mockSendWhatsApp.mock.calls.map((c) => c[2] as string);
}

// ─── Tests: broadcastToReservationPassengers (via dispatchWhatsAppReservationConfirmed) ──

describe("broadcastToReservationPassengers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mockInterpolate to default capture behaviour after vi.clearAllMocks wipes it.
    mockInterpolate.mockImplementation(
      (_template: string, vars: Record<string, string>) => JSON.stringify(vars),
    );
    mockSendWhatsApp.mockResolvedValue({ success: true });
  });

  it("sends one message per passenger when each has a unique phone", async () => {
    // Call order: settings → tripRow → passengers → reservation → client
    setQueue([
      SETTINGS_DEFAULT,                           // 1. systemConfig → use defaults
      [TRIP_ROW],                                 // 2. trip/tenant join
      [PASSENGER_A, PASSENGER_B],                 // 3. passengers
      [RESERVATION_CLIENT],                       // 4. reservationsTable → clientId
      [CLIENT_OPTED_IN],                          // 5. clientsTable
    ]);

    await dispatchWhatsAppReservationConfirmed({
      reservationId: "res-1",
      tenantId: "tenant-1",
    });

    expect(sentPhones()).toEqual([PASSENGER_A.phone, PASSENGER_B.phone]);
    expect(mockSendWhatsApp).toHaveBeenCalledTimes(2);
  });

  it("deduplicates passengers that share the same normalized phone", async () => {
    // PASSENGER_A and a clone with the same phone but different formatting.
    const duplicatePhone = { id: "p2", name: "Duplicate", phone: " +55 11 88888-0001 " };

    setQueue([
      SETTINGS_DEFAULT,
      [TRIP_ROW],
      [PASSENGER_A, duplicatePhone],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppReservationConfirmed({
      reservationId: "res-1",
      tenantId: "tenant-1",
    });

    // Both passengers resolve to the same digits → only one send.
    expect(mockSendWhatsApp).toHaveBeenCalledTimes(1);
    expect(sentPhones()[0]).toBe(PASSENGER_A.phone);
  });

  it("uses the passenger's own phone regardless of client whatsappOptIn", async () => {
    // Passenger has a phone → should be reached even if client opted out.
    setQueue([
      SETTINGS_DEFAULT,
      [TRIP_ROW],
      [PASSENGER_A],                  // passenger has own phone
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_OUT],             // client opted out — irrelevant for passenger's own phone
    ]);

    await dispatchWhatsAppReservationConfirmed({
      reservationId: "res-1",
      tenantId: "tenant-1",
    });

    expect(sentPhones()).toEqual([PASSENGER_A.phone]);
  });

  it("uses client phone as fallback for a passenger with no own phone when client opted in", async () => {
    setQueue([
      SETTINGS_DEFAULT,
      [TRIP_ROW],
      [PASSENGER_NO_PHONE],           // no own phone
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],              // client opted in → use their phone
    ]);

    await dispatchWhatsAppReservationConfirmed({
      reservationId: "res-1",
      tenantId: "tenant-1",
    });

    expect(mockSendWhatsApp).toHaveBeenCalledTimes(1);
    expect(sentPhones()[0]).toBe(CLIENT_OPTED_IN.whatsapp);
  });

  it("sends nothing for a passenger with no phone when client has opted out", async () => {
    setQueue([
      SETTINGS_DEFAULT,
      [TRIP_ROW],
      [PASSENGER_NO_PHONE],           // no own phone
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_OUT],             // client opted out → no fallback
    ]);

    await dispatchWhatsAppReservationConfirmed({
      reservationId: "res-1",
      tenantId: "tenant-1",
    });

    expect(mockSendWhatsApp).not.toHaveBeenCalled();
  });

  it("falls back to client phone when there are zero registered passengers (opt-in)", async () => {
    setQueue([
      SETTINGS_DEFAULT,
      [TRIP_ROW],
      [],                             // no passengers yet
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppReservationConfirmed({
      reservationId: "res-1",
      tenantId: "tenant-1",
    });

    expect(mockSendWhatsApp).toHaveBeenCalledTimes(1);
    expect(sentPhones()[0]).toBe(CLIENT_OPTED_IN.whatsapp);
  });

  it("sends nothing when there are zero passengers and client opted out", async () => {
    setQueue([
      SETTINGS_DEFAULT,
      [TRIP_ROW],
      [],                             // no passengers
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_OUT],
    ]);

    await dispatchWhatsAppReservationConfirmed({
      reservationId: "res-1",
      tenantId: "tenant-1",
    });

    expect(mockSendWhatsApp).not.toHaveBeenCalled();
  });

  it("deduplicates when a passenger phone matches the client phone", async () => {
    // PASSENGER_SAME_AS_CLIENT.phone normalizes to the same digits as CLIENT_OPTED_IN.whatsapp.
    setQueue([
      SETTINGS_DEFAULT,
      [TRIP_ROW],
      [PASSENGER_SAME_AS_CLIENT],     // own phone matches client phone
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppReservationConfirmed({
      reservationId: "res-1",
      tenantId: "tenant-1",
    });

    // Passenger's own phone is sent once; client phone is the same digits → no second send.
    expect(mockSendWhatsApp).toHaveBeenCalledTimes(1);
  });
});

// ─── Tests: dispatchWhatsAppCadastroRealizado toggle ─────────────────────────

describe("dispatchWhatsAppCadastroRealizado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInterpolate.mockImplementation(
      (_template: string, vars: Record<string, string>) => JSON.stringify(vars),
    );
    mockSendWhatsApp.mockResolvedValue({ success: true });
  });

  it("sends nothing when cadastroRealizado is disabled (default false)", async () => {
    // Default settings have cadastroRealizado: false → early return, no DB hits for trip/passengers.
    setQueue([SETTINGS_DEFAULT]);

    await dispatchWhatsAppCadastroRealizado({
      reservationId: "res-1",
      tenantId: "tenant-1",
    });

    expect(mockSendWhatsApp).not.toHaveBeenCalled();
  });

  it("sends to passenger when cadastroRealizado is enabled", async () => {
    setQueue([
      SETTINGS_CADASTRO_ON,
      [{ tripName: "Rio de Janeiro", reservationNumber: "R-002", voucherCode: null, tenantName: "Agência X" }],
      [PASSENGER_A],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppCadastroRealizado({
      reservationId: "res-1",
      tenantId: "tenant-1",
    });

    expect(mockSendWhatsApp).toHaveBeenCalledTimes(1);
    expect(sentPhones()[0]).toBe(PASSENGER_A.phone);
    // Message vars should include the reservation reference.
    const vars = JSON.parse(mockSendWhatsApp.mock.calls[0][2] as string);
    expect(vars).toMatchObject({ referencia: "R-002", viagem: "Rio de Janeiro" });
  });
});

// ─── Tests: dispatchWhatsAppPagamentoPendente toggle ─────────────────────────

describe("dispatchWhatsAppPagamentoPendente", () => {
  const OPTS = {
    reservationId: "res-1",
    tenantId: "tenant-1",
    tripName: "Expedição Norte",
    departureDate: "20/09/2026",
    remainingBalance: 350,
    tenantName: "Agência Norte",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInterpolate.mockImplementation(
      (_template: string, vars: Record<string, string>) => JSON.stringify(vars),
    );
    mockSendWhatsApp.mockResolvedValue({ success: true });
  });

  it("sends nothing when pagamentoPendente is disabled (default false)", async () => {
    setQueue([SETTINGS_DEFAULT]);

    await dispatchWhatsAppPagamentoPendente(OPTS);

    expect(mockSendWhatsApp).not.toHaveBeenCalled();
  });

  it("sends to passenger when pagamentoPendente is enabled", async () => {
    setQueue([
      SETTINGS_PAGAMENTO_ON,
      [PASSENGER_B],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppPagamentoPendente(OPTS);

    expect(mockSendWhatsApp).toHaveBeenCalledTimes(1);
    expect(sentPhones()[0]).toBe(PASSENGER_B.phone);
    const vars = JSON.parse(mockSendWhatsApp.mock.calls[0][2] as string);
    expect(vars).toMatchObject({
      viagem: OPTS.tripName,
      data: OPTS.departureDate,
      agencia: OPTS.tenantName,
    });
    // saldo_restante should be formatted (non-empty).
    expect(vars.saldo_restante).toBeTruthy();
  });

  it("sends nothing when pagamentoPendente enabled but client opted out and no passenger phones", async () => {
    setQueue([
      SETTINGS_PAGAMENTO_ON,
      [PASSENGER_NO_PHONE],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_OUT],
    ]);

    await dispatchWhatsAppPagamentoPendente(OPTS);

    expect(mockSendWhatsApp).not.toHaveBeenCalled();
  });
});

// ─── Tests: dispatchWhatsAppBoardingReminder per-passenger bp resolution ──────

describe("dispatchWhatsAppBoardingReminder", () => {
  const BP_A = { id: "bp-1", name: "Terminal Central",  time: "06:00" };
  const BP_B = { id: "bp-2", name: "Rodoviária Norte",  time: "07:00" };

  const BOARDING_OPTS = {
    reservationId: "res-1",
    tenantId: "tenant-1",
    tripName: "Serra Gaúcha",
    departureDate: "25/10/2026",
    boardingPoints: [BP_A, BP_B],
    tenantName: "Agência RS",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInterpolate.mockImplementation(
      (_template: string, vars: Record<string, string>) => JSON.stringify(vars),
    );
    mockSendWhatsApp.mockResolvedValue({ success: true });
  });

  it("resolves each passenger's specific boarding point from the bpMap", async () => {
    const passengerAtBpA = { id: "p1", name: "Alice", phone: "+5511111110001", boardingLocationId: "bp-1" };
    const passengerAtBpB = { id: "p2", name: "Bob",   phone: "+5511111110002", boardingLocationId: "bp-2" };

    // boardingReminder default = true, so settings row unnecessary — use defaults.
    setQueue([
      SETTINGS_DEFAULT,
      [passengerAtBpA, passengerAtBpB],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppBoardingReminder(BOARDING_OPTS);

    expect(mockSendWhatsApp).toHaveBeenCalledTimes(2);

    const calls = mockSendWhatsApp.mock.calls;
    // First passenger (Alice) → BP_A; phone is arg[1], message is arg[2]
    expect(calls[0][1]).toBe(passengerAtBpA.phone);
    const aliceVars = JSON.parse(calls[0][2] as string);
    expect(aliceVars.local_saida).toBe(BP_A.name);
    expect(aliceVars.horario).toBe(BP_A.time);

    // Second passenger (Bob) → BP_B
    expect(calls[1][1]).toBe(passengerAtBpB.phone);
    const bobVars = JSON.parse(calls[1][2] as string);
    expect(bobVars.local_saida).toBe(BP_B.name);
    expect(bobVars.horario).toBe(BP_B.time);
  });

  it("falls back to the first boarding point when passenger has no boardingLocationId", async () => {
    const passengerNoBp = { id: "p1", name: "Carlos", phone: "+5511222220001", boardingLocationId: null };

    setQueue([
      SETTINGS_DEFAULT,
      [passengerNoBp],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppBoardingReminder(BOARDING_OPTS);

    expect(mockSendWhatsApp).toHaveBeenCalledTimes(1);
    const vars = JSON.parse(mockSendWhatsApp.mock.calls[0][2] as string);
    expect(vars.local_saida).toBe(BP_A.name); // first bp fallback
    expect(vars.horario).toBe(BP_A.time);
  });

  it("uses client phone as fallback when zero passengers and client opted in", async () => {
    setQueue([
      SETTINGS_DEFAULT,
      [],                            // no passengers
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppBoardingReminder(BOARDING_OPTS);

    expect(mockSendWhatsApp).toHaveBeenCalledTimes(1);
    expect(sentPhones()[0]).toBe(CLIENT_OPTED_IN.whatsapp);
    const vars = JSON.parse(mockSendWhatsApp.mock.calls[0][2] as string);
    // Client fallback uses first boarding point and clientName.
    expect(vars.local_saida).toBe(BP_A.name);
  });

  it("respects client opt-out in the zero-passenger fallback path", async () => {
    setQueue([
      SETTINGS_DEFAULT,
      [],                            // no passengers
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_OUT],            // opted out → no fallback
    ]);

    await dispatchWhatsAppBoardingReminder(BOARDING_OPTS);

    expect(mockSendWhatsApp).not.toHaveBeenCalled();
  });

  it("respects client opt-out when passenger has no own phone", async () => {
    const passengerNoBp = { id: "p1", name: "Diana", phone: null, boardingLocationId: "bp-1" };

    setQueue([
      SETTINGS_DEFAULT,
      [passengerNoBp],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_OUT],            // opted out → client phone not used as fallback
    ]);

    await dispatchWhatsAppBoardingReminder(BOARDING_OPTS);

    expect(mockSendWhatsApp).not.toHaveBeenCalled();
  });

  it("sends nothing when boardingReminder is disabled", async () => {
    setQueue([[{ value: { boardingReminder: false } }]]);

    await dispatchWhatsAppBoardingReminder(BOARDING_OPTS);

    expect(mockSendWhatsApp).not.toHaveBeenCalled();
  });
});
