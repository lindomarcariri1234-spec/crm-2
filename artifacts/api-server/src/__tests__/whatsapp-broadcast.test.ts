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
import { normalizeBrazilPhone } from "@workspace/shared";

// ─── Hoisted state (must exist before any vi.mock factory runs) ───────────────

const { setQueue, mockDispatchOutboundMessage, mockInterpolate, mockDb } = vi.hoisted(() => {
  // Shared select queue — tests populate this before each assertion.
  const queue: unknown[][] = [];

  // Build a drizzle-like chain that pops the next row-set on .limit() or direct await.
  function makeChain(): Record<string, unknown> {
    const rows = queue.shift() ?? [];
    const chain: Record<string, unknown> = {};
    chain.from      = vi.fn(() => chain);
    chain.where     = vi.fn(() => chain);
    chain.innerJoin = vi.fn(() => chain);
    chain.orderBy   = vi.fn(() => chain);
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

  const mockDispatchOutboundMessage = vi.fn().mockResolvedValue({
    deliveries: [
      { channel: "email", status: "pending" },
      { channel: "whatsapp", status: "accepted" },
    ],
  });

  // Capture variables so tests can assert message content in boarding tests.
  const mockInterpolate = vi.fn(
    (_template: string, vars: Record<string, string>) => JSON.stringify(vars),
  );

  return {
    setQueue:  (rows: unknown[][]) => { queue.length = 0; queue.push(...rows); },
    mockDb,
    mockDispatchOutboundMessage,
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
  or:         vi.fn((...a: unknown[]) => a),
  sql:        Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
}));

vi.mock("../lib/whatsapp.js", () => ({
  interpolateWhatsAppMessage: mockInterpolate,
}));

vi.mock("../services/outbound-delivery.js", () => ({
  dispatchOutboundMessage: mockDispatchOutboundMessage,
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
  dispatchWhatsAppPaymentReceived,
  dispatchWhatsAppCadastroRealizado,
  dispatchWhatsAppPagamentoPendente,
  dispatchWhatsAppBoardingReminder,
  dispatchWhatsAppReferralConverted,
  dispatchWhatsAppReferralBonusPaid,
  dispatchWhatsAppReferralReversed,
  enqueueOrSend,
} from "../queues/whatsapp-helpers.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Defaults row: returns DEFAULT_NOTIFICATION_SETTINGS (reservationConfirmed=true). */
const SETTINGS_DEFAULT: unknown[] = [];

/** Settings enabling cadastroRealizado. */
const SETTINGS_CADASTRO_ON = [{ value: { cadastroRealizado: true } }];

/** Settings enabling pagamentoPendente. */
const SETTINGS_PAGAMENTO_ON = [{ value: { pagamentoPendente: true } }];

const RESERVATION_CONFIRMED_TEMPLATE =
  "RESERVA {nome} | {viagem} | {data} | {referencia} | {agencia}";
const PAYMENT_RECEIVED_TEMPLATE =
  "PAGAMENTO {nome} | {valor} | {saldo_restante} | {agencia}";
const BOARDING_REMINDER_TEMPLATE =
  "EMBARQUE {nome} | {viagem} | {data} | {local_saida} | {horario} | {agencia}";

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

function sentPhones(): string[] {
  return mockDispatchOutboundMessage.mock.calls.map((c) =>
    canonicalPhone((c[0] as { recipient: { whatsapp: string } }).recipient.whatsapp),
  );
}
function canonicalPhone(phone: string) {
  return normalizeBrazilPhone(phone)!;
}
function sentMessages(): string[] {
  return mockDispatchOutboundMessage.mock.calls.map((c) =>
    (c[0] as { whatsapp: { text: string } }).whatsapp.text,
  );
}

// ─── Tests: broadcastToReservationPassengers (via dispatchWhatsAppReservationConfirmed) ──

describe("enqueueOrSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setQueue([]);
    mockDispatchOutboundMessage.mockResolvedValue({ deliveries: [{ channel: "email", status: "pending" }, { channel: "whatsapp", status: "accepted" }] });
  });

  it("dispatches both channel payloads with deterministic event options", async () => {
    await expect(enqueueOrSend("+5511999990001", "Olá!", "tenant-1", {
      eventType: "reservation_confirmed",
      idempotencyKey: "reservation:res-1:confirmed:client:5511999990001",
      emailSubject: "Reserva confirmada",
    })).resolves.toEqual({
      mode: "queued",
      success: true,
    });

    expect(mockDispatchOutboundMessage).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      eventType: "reservation_confirmed",
      idempotencyKey: "reservation:res-1:confirmed:client:5511999990001",
      recipient: { type: "direct", whatsapp: canonicalPhone("+5511999990001") },
      email: { subject: "Reserva confirmada", html: "<p>Olá!</p>" },
      whatsapp: { text: "Olá!" },
      origin: "legacy_whatsapp",
      originChannel: "whatsapp",
    });
  });

  it("reports a failed WhatsApp delivery while preserving the email delivery", async () => {
    mockDispatchOutboundMessage.mockResolvedValue({
      deliveries: [
        { channel: "email", status: "pending" },
        { channel: "whatsapp", status: "failed", lastError: "gateway_unavailable" },
      ],
    });

    await expect(enqueueOrSend("+5511999990001", "Olá!", "tenant-1")).resolves.toEqual({
      mode: "queued",
      success: true,
      error: "gateway_unavailable",
    });

    expect(mockDispatchOutboundMessage.mock.calls[0][0]).toMatchObject({
      email: { html: "<p>Olá!</p>" },
      whatsapp: { text: "Olá!" },
    });
  });
});

describe("broadcastToReservationPassengers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mockInterpolate to default capture behaviour after vi.clearAllMocks wipes it.
    mockInterpolate.mockImplementation(
      (_template: string, vars: Record<string, string>) => JSON.stringify(vars),
    );
    mockDispatchOutboundMessage.mockResolvedValue({ deliveries: [{ channel: "email", status: "pending" }, { channel: "whatsapp", status: "accepted" }] });
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

    expect(sentPhones()).toEqual([canonicalPhone(PASSENGER_A.phone), canonicalPhone(PASSENGER_B.phone)]);
    expect(mockDispatchOutboundMessage).toHaveBeenCalledTimes(2);
    for (const call of mockDispatchOutboundMessage.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({
        eventType: "reservation_confirmed",
        idempotencyKey: expect.stringMatching(/^reservation:res-1:confirmed:(passenger|client):/),
        email: expect.objectContaining({ html: expect.any(String) }),
        whatsapp: expect.objectContaining({ text: expect.any(String) }),
      }));
    }
  });

  it("uses the configured custom template and interpolates reservation variables", async () => {
    setQueue([
      [{ value: { reservationConfirmedMessage: RESERVATION_CONFIRMED_TEMPLATE } }],
      [TRIP_ROW],
      [PASSENGER_A],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppReservationConfirmed({
      reservationId: "res-1",
      tenantId: "tenant-1",
    });

    expect(mockDispatchOutboundMessage).toHaveBeenCalledOnce();
    expect(mockInterpolate).toHaveBeenCalledWith(
      RESERVATION_CONFIRMED_TEMPLATE,
      expect.objectContaining({
        nome: PASSENGER_A.name,
        viagem: TRIP_ROW.tripName,
        referencia: TRIP_ROW.reservationNumber,
        agencia: TRIP_ROW.tenantName,
      }),
    );
  });

  it("sends nothing when reservation confirmation is disabled", async () => {
    setQueue([[{ value: { reservationConfirmed: false } }]]);

    await dispatchWhatsAppReservationConfirmed({
      reservationId: "res-1",
      tenantId: "tenant-1",
    });

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
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
    expect(mockDispatchOutboundMessage).toHaveBeenCalledTimes(1);
    expect(sentPhones()[0]).toBe(canonicalPhone(PASSENGER_A.phone));
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

    expect(sentPhones()).toEqual([canonicalPhone(PASSENGER_A.phone)]);
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

    expect(mockDispatchOutboundMessage).toHaveBeenCalledTimes(1);
    expect(sentPhones()[0]).toBe(canonicalPhone(CLIENT_OPTED_IN.whatsapp));
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

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
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

    expect(mockDispatchOutboundMessage).toHaveBeenCalledTimes(1);
    expect(sentPhones()[0]).toBe(canonicalPhone(CLIENT_OPTED_IN.whatsapp));
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

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
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
    expect(mockDispatchOutboundMessage).toHaveBeenCalledTimes(1);
  });
});

// ─── Tests: dispatchWhatsAppPaymentReceived ────────────────────────────────────

describe("dispatchWhatsAppPaymentReceived", () => {
  const PAYMENT_OPTS = {
    reservationId: "res-1",
    tenantId: "tenant-1",
    amount: 123.45,
    remainingBalance: 76.55,
  };
  const TENANT_ROW = { name: "Agência Teste" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInterpolate.mockImplementation(
      (_template: string, vars: Record<string, string>) => JSON.stringify(vars),
    );
    mockDispatchOutboundMessage.mockResolvedValue({ deliveries: [{ channel: "email", status: "pending" }, { channel: "whatsapp", status: "accepted" }] });
  });

  it("sends one correctly interpolated message when payment notification is enabled", async () => {
    setQueue([
      SETTINGS_DEFAULT,
      [TENANT_ROW],
      [PASSENGER_A],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppPaymentReceived(PAYMENT_OPTS);

    expect(mockDispatchOutboundMessage).toHaveBeenCalledOnce();
    expect(sentPhones()[0]).toBe(canonicalPhone(PASSENGER_A.phone));
    expect(mockInterpolate).toHaveBeenCalledWith(
      expect.stringContaining("{valor}"),
      expect.objectContaining({
        nome: PASSENGER_A.name,
        valor: "123,45",
        saldo_restante: "76,55",
        agencia: TENANT_ROW.name,
      }),
    );
  });

  it("sends the payment notification to every passenger with a distinct phone", async () => {
    setQueue([
      SETTINGS_DEFAULT,
      [TENANT_ROW],
      [PASSENGER_A, PASSENGER_B],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppPaymentReceived(PAYMENT_OPTS);

    expect(mockDispatchOutboundMessage).toHaveBeenCalledTimes(2);
    expect(sentPhones()).toEqual([canonicalPhone(PASSENGER_A.phone), canonicalPhone(PASSENGER_B.phone)]);
    expect(mockInterpolate).toHaveBeenCalledTimes(2);
  });

  it("deduplicates payment notifications for passengers sharing a phone", async () => {
    const duplicatePhone = {
      id: "p2",
      name: "Duplicate",
      phone: " +55 11 88888-0001 ",
    };
    setQueue([
      SETTINGS_DEFAULT,
      [TENANT_ROW],
      [PASSENGER_A, duplicatePhone],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppPaymentReceived(PAYMENT_OPTS);

    expect(mockDispatchOutboundMessage).toHaveBeenCalledOnce();
    expect(sentPhones()[0]).toBe(canonicalPhone(PASSENGER_A.phone));
  });

  it("uses the configured custom payment template", async () => {
    setQueue([
      [{ value: { paymentReceivedMessage: PAYMENT_RECEIVED_TEMPLATE } }],
      [TENANT_ROW],
      [PASSENGER_A],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppPaymentReceived(PAYMENT_OPTS);

    expect(mockDispatchOutboundMessage).toHaveBeenCalledOnce();
    expect(mockInterpolate).toHaveBeenCalledWith(
      PAYMENT_RECEIVED_TEMPLATE,
      expect.objectContaining({
        nome: PASSENGER_A.name,
        valor: "123,45",
        saldo_restante: "76,55",
      }),
    );
  });

  it("sends nothing when payment notification is disabled", async () => {
    setQueue([[{ value: { paymentReceived: false } }]]);

    await dispatchWhatsAppPaymentReceived(PAYMENT_OPTS);

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
  });

  it("uses the opted-in client as fallback when the passenger has no phone", async () => {
    setQueue([
      SETTINGS_DEFAULT,
      [TENANT_ROW],
      [PASSENGER_NO_PHONE],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppPaymentReceived(PAYMENT_OPTS);

    expect(mockDispatchOutboundMessage).toHaveBeenCalledOnce();
    expect(sentPhones()[0]).toBe(canonicalPhone(CLIENT_OPTED_IN.whatsapp));
    expect(mockInterpolate).toHaveBeenCalledWith(
      expect.stringContaining("{valor}"),
      expect.objectContaining({ nome: PASSENGER_NO_PHONE.name }),
    );
  });

  it("respects client opt-out when payment has no passenger phone", async () => {
    setQueue([
      SETTINGS_DEFAULT,
      [TENANT_ROW],
      [PASSENGER_NO_PHONE],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_OUT],
    ]);

    await dispatchWhatsAppPaymentReceived(PAYMENT_OPTS);

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
  });
});

// ─── Tests: dispatchWhatsAppCadastroRealizado toggle ─────────────────────────

describe("dispatchWhatsAppCadastroRealizado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInterpolate.mockImplementation(
      (_template: string, vars: Record<string, string>) => JSON.stringify(vars),
    );
    mockDispatchOutboundMessage.mockResolvedValue({ deliveries: [{ channel: "email", status: "pending" }, { channel: "whatsapp", status: "accepted" }] });
  });

  it("sends nothing when cadastroRealizado is disabled (default false)", async () => {
    // Default settings have cadastroRealizado: false → early return, no DB hits for trip/passengers.
    setQueue([SETTINGS_DEFAULT]);

    await dispatchWhatsAppCadastroRealizado({
      reservationId: "res-1",
      tenantId: "tenant-1",
    });

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
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

    expect(mockDispatchOutboundMessage).toHaveBeenCalledTimes(1);
    expect(sentPhones()[0]).toBe(canonicalPhone(PASSENGER_A.phone));
    // Message vars should include the reservation reference.
    const vars = JSON.parse(sentMessages()[0]);
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
    mockDispatchOutboundMessage.mockResolvedValue({ deliveries: [{ channel: "email", status: "pending" }, { channel: "whatsapp", status: "accepted" }] });
  });

  it("sends nothing when pagamentoPendente is disabled (default false)", async () => {
    setQueue([SETTINGS_DEFAULT]);

    await dispatchWhatsAppPagamentoPendente(OPTS);

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
  });

  it("sends to passenger when pagamentoPendente is enabled", async () => {
    setQueue([
      SETTINGS_PAGAMENTO_ON,
      [PASSENGER_B],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppPagamentoPendente(OPTS);

    expect(mockDispatchOutboundMessage).toHaveBeenCalledTimes(1);
    expect(sentPhones()[0]).toBe(canonicalPhone(PASSENGER_B.phone));
    const vars = JSON.parse(sentMessages()[0]);
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

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
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
    mockDispatchOutboundMessage.mockResolvedValue({ deliveries: [{ channel: "email", status: "pending" }, { channel: "whatsapp", status: "accepted" }] });
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

    expect(mockDispatchOutboundMessage).toHaveBeenCalledTimes(2);

    const calls = mockDispatchOutboundMessage.mock.calls;
    // First passenger (Alice) → BP_A; both channel payloads share the message.
    expect((calls[0][0] as any).recipient.whatsapp).toBe(canonicalPhone(passengerAtBpA.phone));
    const aliceVars = JSON.parse((calls[0][0] as any).whatsapp.text);
    expect(aliceVars.local_saida).toBe(BP_A.name);
    expect(aliceVars.horario).toBe(BP_A.time);

    // Second passenger (Bob) → BP_B
    expect((calls[1][0] as any).recipient.whatsapp).toBe(canonicalPhone(passengerAtBpB.phone));
    const bobVars = JSON.parse((calls[1][0] as any).whatsapp.text);
    expect(bobVars.local_saida).toBe(BP_B.name);
    expect(bobVars.horario).toBe(BP_B.time);
  });

  it("uses the configured custom boarding template", async () => {
    const passenger = {
      id: "p1",
      name: "Alice",
      phone: "+5511111110001",
      boardingLocationId: "bp-1",
    };
    setQueue([
      [{ value: { boardingReminderMessage: BOARDING_REMINDER_TEMPLATE } }],
      [passenger],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppBoardingReminder(BOARDING_OPTS);

    expect(mockDispatchOutboundMessage).toHaveBeenCalledOnce();
    expect(mockInterpolate).toHaveBeenCalledWith(
      BOARDING_REMINDER_TEMPLATE,
      expect.objectContaining({
        nome: passenger.name,
        viagem: BOARDING_OPTS.tripName,
        data: BOARDING_OPTS.departureDate,
        local_saida: BP_A.name,
        horario: BP_A.time,
        agencia: BOARDING_OPTS.tenantName,
      }),
    );
  });

  it("deduplicates boarding reminders for passengers sharing a phone", async () => {
    const duplicatePhone = {
      id: "p2",
      name: "Duplicate",
      phone: " +55 11 11111-0001 ",
      boardingLocationId: "bp-2",
    };
    const firstPassenger = {
      id: "p1",
      name: "Alice",
      phone: "+5511111110001",
      boardingLocationId: "bp-1",
    };
    setQueue([
      SETTINGS_DEFAULT,
      [firstPassenger, duplicatePhone],
      [RESERVATION_CLIENT],
      [CLIENT_OPTED_IN],
    ]);

    await dispatchWhatsAppBoardingReminder(BOARDING_OPTS);

    expect(mockDispatchOutboundMessage).toHaveBeenCalledOnce();
    expect(sentPhones()[0]).toBe(canonicalPhone(firstPassenger.phone));
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

    expect(mockDispatchOutboundMessage).toHaveBeenCalledTimes(1);
    const vars = JSON.parse(sentMessages()[0]);
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

    expect(mockDispatchOutboundMessage).toHaveBeenCalledTimes(1);
    expect(sentPhones()[0]).toBe(canonicalPhone(CLIENT_OPTED_IN.whatsapp));
    const vars = JSON.parse(sentMessages()[0]);
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

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
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

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
  });

  it("sends nothing when boardingReminder is disabled", async () => {
    setQueue([[{ value: { boardingReminder: false } }]]);

    await dispatchWhatsAppBoardingReminder(BOARDING_OPTS);

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
  });
});

// ─── Tests: referral dispatcher opt-in gate ───────────────────────────────────

const REFERRAL_SETTINGS_ENABLED = [{
  whatsappEnabled: true,
  whatsappConvertedMessage: null,
  whatsappBonusPaidMessage: null,
  whatsappReversedMessage: null,
}];

const REFERRER_OPTED_IN = {
  whatsapp: "+5511999990001",
  phone: null,
  whatsappOptIn: true,
};

const REFERRER_OPTED_OUT = {
  whatsapp: "+5511999990001",
  phone: null,
  whatsappOptIn: false,
};

const TENANT_ROW = [{ name: "Agência Teste" }];
const LATEST_REFERRAL_ROW = [{ bonusAmount: "50.00" }];

describe("dispatchWhatsAppReferralConverted — whatsappOptIn gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatchOutboundMessage.mockResolvedValue({ deliveries: [{ channel: "email", status: "pending" }, { channel: "whatsapp", status: "accepted" }] });
  });

  it("sends to referrer who has whatsappOptIn = true", async () => {
    setQueue([
      REFERRAL_SETTINGS_ENABLED,
      [REFERRER_OPTED_IN],
      TENANT_ROW,
      LATEST_REFERRAL_ROW,
    ]);

    await dispatchWhatsAppReferralConverted({
      referrerId: "ref-1",
      referredName: "Ana",
      referralCode: "CODE1",
      tenantId: "tenant-1",
    });

    expect(mockDispatchOutboundMessage).toHaveBeenCalledOnce();
    expect((mockDispatchOutboundMessage.mock.calls[0][0] as any).recipient.whatsapp).toBe(canonicalPhone("+5511999990001"));
    expect(mockDispatchOutboundMessage.mock.calls[0][0]).toEqual(expect.objectContaining({
      eventType: "referral_converted",
      idempotencyKey: "referral:tenant-1:ref-1:CODE1:converted",
      email: expect.objectContaining({ html: expect.any(String) }),
      whatsapp: expect.objectContaining({ text: expect.any(String) }),
    }));
  });

  it("skips referrer who has whatsappOptIn = false", async () => {
    setQueue([
      REFERRAL_SETTINGS_ENABLED,
      [REFERRER_OPTED_OUT],
    ]);

    await dispatchWhatsAppReferralConverted({
      referrerId: "ref-1",
      referredName: "Ana",
      referralCode: "CODE1",
      tenantId: "tenant-1",
    });

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
  });

  it("skips when whatsapp is disabled in referral settings", async () => {
    setQueue([[{ whatsappEnabled: false }]]);

    await dispatchWhatsAppReferralConverted({
      referrerId: "ref-1",
      referredName: "Ana",
      referralCode: "CODE1",
      tenantId: "tenant-1",
    });

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
  });
});

describe("dispatchWhatsAppReferralBonusPaid — whatsappOptIn gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatchOutboundMessage.mockResolvedValue({ deliveries: [{ channel: "email", status: "pending" }, { channel: "whatsapp", status: "accepted" }] });
  });

  it("sends to referrer who has whatsappOptIn = true", async () => {
    setQueue([
      REFERRAL_SETTINGS_ENABLED,
      [REFERRER_OPTED_IN],
    ]);

    await dispatchWhatsAppReferralBonusPaid({
      referrerId: "ref-1",
      referrerPhone: null,
      referrerName: "João",
      referralCode: "CODE1",
      bonusAmount: 50,
      tenantId: "tenant-1",
      tenantName: "Agência Teste",
    });

    expect(mockDispatchOutboundMessage).toHaveBeenCalledOnce();
    expect((mockDispatchOutboundMessage.mock.calls[0][0] as any).recipient.whatsapp).toBe(canonicalPhone("+5511999990001"));
  });

  it("skips referrer who has whatsappOptIn = false even when referrerPhone is supplied", async () => {
    setQueue([
      REFERRAL_SETTINGS_ENABLED,
      [REFERRER_OPTED_OUT],
    ]);

    await dispatchWhatsAppReferralBonusPaid({
      referrerId: "ref-1",
      referrerPhone: "+5511888880001", // caller-supplied phone — must be ignored
      referrerName: "João",
      referralCode: "CODE1",
      bonusAmount: 50,
      tenantId: "tenant-1",
      tenantName: "Agência Teste",
    });

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
  });
});

describe("dispatchWhatsAppReferralReversed — whatsappOptIn gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatchOutboundMessage.mockResolvedValue({ deliveries: [{ channel: "email", status: "pending" }, { channel: "whatsapp", status: "accepted" }] });
  });

  it("sends to referrer who has whatsappOptIn = true", async () => {
    setQueue([
      REFERRAL_SETTINGS_ENABLED,
      [REFERRER_OPTED_IN],
      TENANT_ROW,
    ]);

    await dispatchWhatsAppReferralReversed({
      referrerId: "ref-1",
      referredName: "Maria",
      bonusAmount: 50,
      newPendingBalance: 100,
      tenantId: "tenant-1",
    });

    expect(mockDispatchOutboundMessage).toHaveBeenCalledOnce();
    expect((mockDispatchOutboundMessage.mock.calls[0][0] as any).recipient.whatsapp).toBe(canonicalPhone("+5511999990001"));
  });

  it("skips referrer who has whatsappOptIn = false", async () => {
    setQueue([
      REFERRAL_SETTINGS_ENABLED,
      [REFERRER_OPTED_OUT],
    ]);

    await dispatchWhatsAppReferralReversed({
      referrerId: "ref-1",
      referredName: "Maria",
      bonusAmount: 50,
      newPendingBalance: 100,
      tenantId: "tenant-1",
    });

    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
  });
});
