import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireAuth, mockSelect } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockSelect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  chatbotConversationsTable: {},
  chatbotMessagesTable: {},
  clientsTable: {},
  usersTable: {},
  supportTicketsTable: {},
  tenantIntegrationsTable: {},
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  ALL_STAFF_ROLES: ["superadmin", "agencia", "gerente", "vendedor", "suporte"],
  ADMIN_ROLES: ["superadmin", "agencia"],
}));

vi.mock("../lib/crypto.js", () => ({ decryptCredential: vi.fn() }));
vi.mock("../lib/uploadthing.js", () => ({
  extractVerifiedUploadThingKey: vi.fn(),
  utapi: { deleteFiles: vi.fn() },
}));
vi.mock("../lib/whatsapp-media-retention.js", () => ({
  getWhatsAppInboundMediaExpirationAt: vi.fn(),
}));
vi.mock("../lib/realtime.js", () => ({ broadcastSupportTicketUpdate: vi.fn() }));
vi.mock("../lib/id.js", () => ({ generateId: vi.fn() }));
vi.mock("../services/whatsapp-attendance.js", () => ({ deliverAttendanceReply: vi.fn() }));
vi.mock("../services/instagram-messaging.js", () => ({
  getInstagramMetaConfig: vi.fn(),
  isInstagramReplyWindowOpen: vi.fn(),
  INSTAGRAM_MESSAGING_TYPE: "instagram",
  InstagramProviderError: class InstagramProviderError extends Error {},
  readInstagramAccessToken: vi.fn(),
  sendInstagramText: vi.fn(),
}));
vi.mock("../services/instagram-zernio.js", () => ({
  INSTAGRAM_ZERNIO_TYPE: "instagram_zernio",
  sendZernioInstagramText: vi.fn(),
  ZernioInstagramSendError: class ZernioInstagramSendError extends Error {},
}));
vi.mock("../services/client-classification.js", () => ({
  recomputeClientClassification: vi.fn(),
  recordClientClassificationEvent: vi.fn(),
}));
vi.mock("../services/support-ticketing.js", () => ({
  ensureSupportTicketForConversation: vi.fn(),
  recordSupportTicketEvent: vi.fn(),
}));

import chatbotRouter from "../routes/chatbot.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(chatbotRouter);
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

describe("agency chatbot inbox is staff-only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      id: "client-user",
      tenantId: "tenant-a",
      role: "cliente",
      name: "Client",
    });
  });

  it("does not expose the agency conversation list to a client", async () => {
    const res = await request(makeApp()).get("/chatbot-conversations");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("does not allow a client to send an inbox reply", async () => {
    const res = await request(makeApp())
      .post("/chatbot-conversations/conversation-a/reply")
      .send({ content: "hello" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
