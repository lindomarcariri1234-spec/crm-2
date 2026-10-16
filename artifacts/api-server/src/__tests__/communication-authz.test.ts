import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAuth,
  mockSelect,
  mockDispatchOutboundMessage,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockSelect: vi.fn(),
  mockDispatchOutboundMessage: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  messagesTable: {},
  messageTemplatesTable: {},
  automationsTable: {},
  clientsTable: {},
  emailLogsTable: {},
  reservationsTable: {},
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["superadmin", "agencia"],
  MANAGEMENT_ROLES: ["superadmin", "agencia", "gerente"],
  ALL_STAFF_ROLES: ["superadmin", "agencia", "gerente", "vendedor", "suporte"],
}));

vi.mock("../queues/email-helpers.js", () => ({
  resendEmailLog: vi.fn(),
}));

vi.mock("../services/outbound-delivery.js", () => ({
  dispatchOutboundMessage: mockDispatchOutboundMessage,
}));

import communicationRouter from "../routes/communication.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(communicationRouter);
  app.use((
    error: Error & { status?: number; statusCode?: number; code?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(error.statusCode ?? error.status ?? 500).json({ code: error.code });
  });
  return app;
}

describe("communication routes reject client accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      id: "client-user",
      tenantId: "tenant-a",
      role: "cliente",
      name: "Client",
    });
  });

  it("does not expose agency-wide messages or messaging client lists", async () => {
    const messages = await request(makeApp()).get("/messages");
    const clients = await request(makeApp()).get("/clients-for-messaging");

    expect(messages.status).toBe(403);
    expect(clients.status).toBe(403);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("does not allow a client to send a message through the agency account", async () => {
    const res = await request(makeApp())
      .post("/messages")
      .send({ toClientId: "another-client", channel: "email", content: "hello" });

    expect(res.status).toBe(403);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
  });
});
