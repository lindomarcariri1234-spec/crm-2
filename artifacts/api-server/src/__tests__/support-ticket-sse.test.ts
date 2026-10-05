import { EventEmitter } from "node:events";
import type { Response } from "express";
import { ALL_STAFF_ROLES } from "@workspace/permissions";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  addSupportTicketClient,
  emitSupportTicketRefresh,
  emitSupportTicketUpdate,
  isSupportTicketStreamAuthorized,
  monitorSupportTicketClient,
  parseSupportTicketBroadcastUpdate,
  parseSupportTicketUpdatePayload,
  removeSupportTicketClient,
  SUPPORT_TICKET_STREAM_HEARTBEAT_MS,
  type SupportTicketUpdatePayload,
} from "../lib/support-ticket-sse.js";
import { malformedSupportTicketSsePayloads } from "./support-ticket-sse-fixtures.js";

function mockResponse() {
  return { write: vi.fn() } as unknown as Response & { write: ReturnType<typeof vi.fn> };
}

function mockStreamingResponse() {
  const response = new EventEmitter();
  const write = vi.fn();
  const end = vi.fn();
  Object.assign(response, { write, end });
  return response as unknown as Response & {
    write: typeof write;
    end: typeof end;
    emit: typeof response.emit;
  };
}

describe("support ticket SSE tenant fan-out", () => {
  const clients: Array<{ tenantId: string; response: Response }> = [];

  afterEach(() => {
    for (const client of clients.splice(0)) {
      removeSupportTicketClient(client.tenantId, client.response);
    }
    vi.useRealTimers();
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

  it("projects valid payloads onto the shared public contract", () => {
    expect(parseSupportTicketUpdatePayload({
      eventId: "event-public",
      type: "ticket",
      ticketId: "ticket-public",
      customerEmail: "must-not-be-forwarded@example.test",
    })).toEqual({
      eventId: "event-public",
      type: "ticket",
      ticketId: "ticket-public",
    });
    expect(parseSupportTicketBroadcastUpdate({
      type: "queues",
      ticketId: null,
      internalQueueMetadata: "must-not-be-forwarded",
    })).toEqual({ type: "queues", ticketId: null });
    expect(parseSupportTicketBroadcastUpdate({ type: "refresh", ticketId: null })).toBeNull();
  });

  it("rejects the same malformed payload shapes at parser and direct-emitter boundaries", () => {
    const response = mockResponse();
    clients.push({ tenantId: "tenant-invalid", response });
    addSupportTicketClient("tenant-invalid", response);

    for (const payload of malformedSupportTicketSsePayloads) {
      expect(parseSupportTicketUpdatePayload(payload)).toBeNull();
      expect(() =>
        emitSupportTicketUpdate(
          "tenant-invalid",
          payload as unknown as SupportTicketUpdatePayload,
        ),
      ).toThrow("Invalid support-ticket SSE payload");
    }
    expect(response.write).not.toHaveBeenCalled();
  });

  it("strips unexpected fields before direct SSE delivery", () => {
    const response = mockResponse();
    clients.push({ tenantId: "tenant-public", response });
    addSupportTicketClient("tenant-public", response);

    emitSupportTicketUpdate("tenant-public", {
      eventId: "event-public",
      type: "ticket",
      ticketId: "ticket-public",
      customerEmail: "must-not-be-forwarded@example.test",
    } as unknown as SupportTicketUpdatePayload);

    expect(response.write).toHaveBeenCalledWith(
      `id: event-public\ndata: {"eventId":"event-public","type":"ticket","ticketId":"ticket-public"}\n\n`,
    );
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

  it("rejects streams for disabled, moved, or no-longer-staff users", () => {
    const connectedUser = { id: "user-one", tenantId: "tenant-one" };
    const activeStaff = {
      id: "user-one",
      tenantId: "tenant-one",
      role: ALL_STAFF_ROLES[ALL_STAFF_ROLES.length - 1]!,
      isActive: true,
    };

    expect(isSupportTicketStreamAuthorized(connectedUser, activeStaff)).toBe(true);
    expect(isSupportTicketStreamAuthorized(connectedUser, null)).toBe(false);
    expect(isSupportTicketStreamAuthorized(connectedUser, {
      ...activeStaff,
      isActive: false,
    })).toBe(false);
    expect(isSupportTicketStreamAuthorized(connectedUser, {
      ...activeStaff,
      tenantId: "tenant-two",
    })).toBe(false);
    expect(isSupportTicketStreamAuthorized(connectedUser, {
      ...activeStaff,
      role: "customer",
    })).toBe(false);
  });

  it("ends and unregisters a stream when its access is revoked", async () => {
    vi.useFakeTimers();
    const response = mockStreamingResponse();
    const isAuthorized = vi.fn(async () => false);
    clients.push({ tenantId: "tenant-revoked", response });
    monitorSupportTicketClient("tenant-revoked", response, isAuthorized);

    await vi.advanceTimersByTimeAsync(SUPPORT_TICKET_STREAM_HEARTBEAT_MS);

    expect(isAuthorized).toHaveBeenCalledOnce();
    expect(response.end).toHaveBeenCalledOnce();
    response.write.mockClear();
    emitSupportTicketUpdate("tenant-revoked", {
      eventId: "after-revocation",
      type: "ticket",
      ticketId: "ticket-one",
    });
    expect(response.write).not.toHaveBeenCalled();
  });

  it("keeps authorized streams tenant-scoped and removes them on normal disconnect", async () => {
    vi.useFakeTimers();
    const authorizedResponse = mockStreamingResponse();
    const otherTenantResponse = mockResponse();
    const isAuthorized = vi.fn(async () => true);
    clients.push(
      { tenantId: "tenant-authorized", response: authorizedResponse },
      { tenantId: "tenant-other", response: otherTenantResponse },
    );
    monitorSupportTicketClient("tenant-authorized", authorizedResponse, isAuthorized);
    addSupportTicketClient("tenant-other", otherTenantResponse);

    await vi.advanceTimersByTimeAsync(SUPPORT_TICKET_STREAM_HEARTBEAT_MS);
    expect(isAuthorized).toHaveBeenCalledOnce();
    expect(authorizedResponse.end).not.toHaveBeenCalled();

    authorizedResponse.write.mockClear();
    emitSupportTicketUpdate("tenant-authorized", {
      eventId: "authorized-update",
      type: "ticket",
      ticketId: "ticket-one",
    });
    emitSupportTicketUpdate("tenant-other", {
      eventId: "other-tenant-update",
      type: "ticket",
      ticketId: "ticket-two",
    });
    expect(authorizedResponse.write).toHaveBeenCalledOnce();
    expect(otherTenantResponse.write).toHaveBeenCalledWith(
      `id: other-tenant-update\ndata: {"eventId":"other-tenant-update","type":"ticket","ticketId":"ticket-two"}\n\n`,
    );
    expect(otherTenantResponse.write).not.toHaveBeenCalledWith(
      `id: authorized-update\ndata: {"eventId":"authorized-update","type":"ticket","ticketId":"ticket-one"}\n\n`,
    );

    authorizedResponse.emit("close");
    expect(vi.getTimerCount()).toBe(0);
    authorizedResponse.write.mockClear();
    emitSupportTicketUpdate("tenant-authorized", {
      eventId: "after-disconnect",
      type: "ticket",
      ticketId: "ticket-one",
    });
    expect(authorizedResponse.write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SUPPORT_TICKET_STREAM_HEARTBEAT_MS);
    expect(isAuthorized).toHaveBeenCalledOnce();
  });
});
