import type { Response } from "express";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
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

  it("models only valid event and ticket ID combinations", () => {
    expectTypeOf<SupportTicketUpdatePayload>().toEqualTypeOf<
      | { eventId: string; type: "ticket"; ticketId: string }
      | { eventId: string; type: "queues"; ticketId: null }
      | { eventId: string; type: "refresh"; ticketId: null }
    >();

    const acceptsPayload = (payload: SupportTicketUpdatePayload) => payload;
    // @ts-expect-error ticket events require a ticket ID
    acceptsPayload({ eventId: "bad-ticket", type: "ticket", ticketId: null });
    // @ts-expect-error queue events must not identify one ticket
    acceptsPayload({ eventId: "bad-queue", type: "queues", ticketId: "ticket-one" });
    // @ts-expect-error refresh hints do not identify one ticket
    acceptsPayload({ eventId: "bad-refresh", type: "refresh", ticketId: "ticket-one" });
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

  it("emits a valid queue update with its null ticket ID unchanged", () => {
    const response = mockResponse();
    clients.push({ tenantId: "tenant-queues", response });
    addSupportTicketClient("tenant-queues", response);
    const payload: SupportTicketUpdatePayload = {
      eventId: "queue-update-123",
      type: "queues",
      ticketId: null,
    };

    emitSupportTicketUpdate("tenant-queues", payload);

    expect(response.write).toHaveBeenCalledWith(
      `id: ${payload.eventId}\ndata: ${JSON.stringify(payload)}\n\n`,
    );
  });

  it("does not write event payloads with mismatched types and ticket IDs", () => {
    const response = mockResponse();
    clients.push({ tenantId: "tenant-invalid", response });
    addSupportTicketClient("tenant-invalid", response);
    const invalidPayloads = [
      { eventId: "bad-ticket", type: "ticket", ticketId: null },
      { eventId: "bad-queue", type: "queues", ticketId: "ticket-one" },
      { eventId: "bad-refresh", type: "refresh", ticketId: "ticket-one" },
    ];

    for (const payload of invalidPayloads) {
      expect(() =>
        emitSupportTicketUpdate(
          "tenant-invalid",
          payload as unknown as SupportTicketUpdatePayload,
        ),
      ).toThrow("Invalid support-ticket SSE payload");
    }
    expect(response.write).not.toHaveBeenCalled();
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
