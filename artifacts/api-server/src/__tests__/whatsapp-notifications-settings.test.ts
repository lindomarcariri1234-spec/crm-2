import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const {
  mockRequireAuth,
  mockSelect,
  mockInsert,
  mockUpdate,
  getStoredConfig,
  resetStoredConfig,
} = vi.hoisted(() => {
  type ConfigRow = { value: Record<string, unknown> } & Record<string, unknown>;
  let storedConfig: ConfigRow | null = null;

  const getStoredConfig = () => storedConfig;
  const resetStoredConfig = () => {
    storedConfig = null;
  };

  const mockRequireAuth = vi.fn();

  const mockSelect = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(async () => (storedConfig ? [storedConfig] : []));
    return chain;
  });

  const mockInsert = vi.fn(() => ({
    values: vi.fn(async (values: ConfigRow) => {
      storedConfig = values;
    }),
  }));

  const mockUpdate = vi.fn(() => ({
    set: vi.fn((values: Partial<ConfigRow>) => ({
      where: vi.fn(async () => {
        storedConfig = storedConfig ? { ...storedConfig, ...values } : null;
      }),
    })),
  }));

  return {
    mockRequireAuth,
    mockSelect,
    mockInsert,
    mockUpdate,
    getStoredConfig,
    resetStoredConfig,
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  },
  systemConfigsTable: { tenantId: "tenantId", key: "key" },
  referralSettingsTable: {},
  clientsTable: {},
  tenantsTable: {},
  referralsTable: {},
  passengersTable: {},
  reservationsTable: {},
  tripsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn(() => "eq"),
  desc: vi.fn(() => "desc"),
  inArray: vi.fn(() => "inArray"),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  ADMIN_ROLES: ["agency_admin"],
}));

vi.mock("../lib/whatsapp.js", () => ({
  sendTenantWhatsAppMessage: vi.fn(),
  interpolateWhatsAppMessage: vi.fn(),
}));

vi.mock("../queues/index.js", () => ({
  getWhatsAppQueue: vi.fn(() => null),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@workspace/permissions", () => ({
  REFERRAL_STATUS: {},
}));

vi.mock("@workspace/shared", () => ({
  formatBRL: vi.fn((amount: number) => String(amount)),
}));

import { requireAuth } from "../lib/tenant.js";
import whatsappNotificationsRouter from "../routes/whatsapp-notifications.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const TENANT_ID = "tenant-001";
const ADMIN_USER = {
  id: "user-001",
  tenantId: TENANT_ID,
  role: "agency_admin",
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", whatsappNotificationsRouter);
  app.use(errorHandler);
  return app;
}

const DEFAULT_SETTINGS = {
  reservationConfirmed: true,
  paymentReceived: true,
  boardingReminder: true,
  cadastroRealizado: false,
  pagamentoPendente: false,
  pagamentoPendenteDaysBeforeTrip: 7,
  boardingReminderDaysBeforeTrip: [1],
};

describe("WhatsApp notification settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStoredConfig();
    vi.mocked(requireAuth).mockResolvedValue(ADMIN_USER as never);
  });

  it("returns defaults when no configuration is stored", async () => {
    const response = await request(buildApp()).get("/api/whatsapp-notifications/settings");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(DEFAULT_SETTINGS);
    expect(getStoredConfig()).toBeNull();
  });

  it("persists a partial update and returns the merged settings on the next GET", async () => {
    const update = {
      reservationConfirmed: false,
      reservationConfirmedMessage: "Reserva {referencia} confirmada",
      paymentReceived: false,
      boardingReminder: false,
      boardingReminderDaysBeforeTrip: [3, 14],
      cadastroRealizado: true,
      pagamentoPendente: true,
      pagamentoPendenteDaysBeforeTrip: 21,
    };

    const putResponse = await request(buildApp())
      .put("/api/whatsapp-notifications/settings")
      .send(update);

    expect(putResponse.status).toBe(200);
    expect(putResponse.body).toEqual({ ...DEFAULT_SETTINGS, ...update });
    expect(getStoredConfig()).toMatchObject({ value: { ...DEFAULT_SETTINGS, ...update } });

    const getResponse = await request(buildApp()).get("/api/whatsapp-notifications/settings");

    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toEqual({ ...DEFAULT_SETTINGS, ...update });
  });

  it.each([0, 15])(
    "rejects boardingReminderDaysBeforeTrip=%s outside the 1–14 range",
    async (daysBeforeTrip) => {
      const response = await request(buildApp())
        .put("/api/whatsapp-notifications/settings")
        .send({ boardingReminderDaysBeforeTrip: [daysBeforeTrip] });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    },
  );

  it.each([0, 31])(
    "rejects pagamentoPendenteDaysBeforeTrip=%s outside the 1–30 range",
    async (daysBeforeTrip) => {
      const response = await request(buildApp())
        .put("/api/whatsapp-notifications/settings")
        .send({ pagamentoPendenteDaysBeforeTrip: daysBeforeTrip });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    },
  );
});