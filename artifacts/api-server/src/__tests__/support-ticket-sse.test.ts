import type { Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addSupportTicketClient,
  emitSupportTicketRefresh,
  emitSupportTicketUpdate,
  removeSupportTicketClient,
  type SupportTicketUpdatePayload,
} from "../lib/support-ticket-sse.js";

function mockResponse() {
  return { write: vi.fn() } as unknown as Response & { write: ReturnType<typeof vi.fn> };
}

describe("support ticket SSE tenant fan-out", () => {
  const clients: Array<{ tenantId: string; response: Response }> = [];

  afterEach(() => {
    for (const client of clients.splice(0)) {
      removeSupportTicketClient(client.tenantId, client.response);
    }
  });

  it("sends updates only to connected staff streams in the target tenant", () => {
    const tenantOneResponse = mockResponse();
    const tenantTwoResponse = mockResponse();
    clients.push(
      { tenantId: "tenant-one", response: tenantOneResponse },
      { tenantId: "tenant-two", response: tenantTwoResponse },
    );
    addSupportTicketClient("tenant-one", tenantOneResponse);
    addSupportTicketClient("tenant-two", tenantTwoResponse);

    const payload: SupportTicketUpdatePayload = {
      eventId: "update-123",
      type: "ticket",
      ticketId: "ticket-one",
    };
    emitSupportTicketUpdate("tenant-one", payload);

    expect(tenantOneResponse.write).toHaveBeenCalledOnce();
    expect(tenantOneResponse.write).toHaveBeenCalledWith(
      `id: ${payload.eventId}\ndata: ${JSON.stringify(payload)}\n\n`,
    );
    expect(tenantTwoResponse.write).not.toHaveBeenCalled();
  });

  it("refreshes each connected tenant's own inbox after Redis recovery", () => {
    const firstTenantResponse = mockResponse();
    const secondTenantResponse = mockResponse();
    const otherTenantResponse = mockResponse();
    clients.push(
      { tenantId: "tenant-one", response: firstTenantResponse },
      { tenantId: "tenant-one", response: secondTenantResponse },
      { tenantId: "tenant-two", response: otherTenantResponse },
    );
    addSupportTicketClient("tenant-one", firstTenantResponse);
    addSupportTicketClient("tenant-one", secondTenantResponse);
    addSupportTicketClient("tenant-two", otherTenantResponse);

    emitSupportTicketRefresh("redis-recovery-1");

    const expectedPayload: SupportTicketUpdatePayload = {
      eventId: "redis-recovery-1",
      type: "refresh",
      ticketId: null,
    };
    const expectedEvent = `id: ${expectedPayload.eventId}\ndata: ${JSON.stringify(expectedPayload)}\n\n`;
    expect(firstTenantResponse.write).toHaveBeenCalledWith(expectedEvent);
    expect(secondTenantResponse.write).toHaveBeenCalledWith(expectedEvent);
    expect(otherTenantResponse.write).toHaveBeenCalledWith(expectedEvent);
  });

  it("does not retain disconnected streams after a write fails", () => {
    const disconnectedResponse = mockResponse();
    disconnectedResponse.write.mockImplementation(() => {
      throw new Error("stream closed");
    });
    addSupportTicketClient("tenant-disconnected", disconnectedResponse);

    emitSupportTicketUpdate("tenant-disconnected", {
      eventId: "update-closed",
      type: "queues",
      ticketId: null,
    });
    emitSupportTicketUpdate("tenant-disconnected", {
      eventId: "update-closed-again",
      type: "queues",
      ticketId: null,
    });

    expect(disconnectedResponse.write).toHaveBeenCalledOnce();
  });
});
