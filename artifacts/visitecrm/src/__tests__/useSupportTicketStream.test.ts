import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupRoots,
  flushAct,
  installMockEventSource,
  MockEventSource,
  renderHook,
  restoreEventSource,
} from "./eventSourceHarness.js";
import { useSupportTicketStream } from "../hooks/useSupportTicketStream";

describe("useSupportTicketStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockEventSource();
  });

  afterEach(async () => {
    await cleanupRoots();
    restoreEventSource();
  });

  it("rehydrates on reconnect and ignores duplicate ticket and queue events", async () => {
    let tenantId: string | null = "tenant-one";
    const onOpen = vi.fn();
    let onTicketUpdate = vi.fn();
    const onQueuesUpdate = vi.fn();
    const hook = await renderHook(() => useSupportTicketStream({
      tenantId,
      enabled: true,
      onOpen,
      onTicketUpdate,
      onQueuesUpdate,
    }));
    const stream = MockEventSource.last();

    expect(stream.url).toContain("/api/support/tickets/stream");
    expect(stream.withCredentials).toBe(true);
    await flushAct(() => stream.emitOpen());
    expect(onOpen).toHaveBeenCalledOnce();

    const ticketEvent = JSON.stringify({
      eventId: "event-ticket-1",
      type: "ticket",
      ticketId: "ticket-1",
    });
    await flushAct(() => {
      stream.emitMessage(ticketEvent);
      stream.emitMessage(ticketEvent);
    });
    expect(onTicketUpdate).toHaveBeenCalledOnce();
    expect(onTicketUpdate).toHaveBeenCalledWith("ticket-1");

    const queueEvent = JSON.stringify({
      eventId: "event-queues-1",
      type: "queues",
      ticketId: null,
    });
    await flushAct(() => {
      stream.emitMessage(queueEvent);
      stream.emitMessage(queueEvent);
      stream.emitMessage("{malformed");
    });
    expect(onQueuesUpdate).toHaveBeenCalledOnce();

    await flushAct(() => stream.emitError());
    expect(stream.closeCount).toBe(0);
    await flushAct(() => stream.emitOpen());
    expect(onOpen).toHaveBeenCalledTimes(2);

    const rerenderedTicketUpdate = vi.fn();
    onTicketUpdate = rerenderedTicketUpdate;
    await hook.rerender();
    const replacementStream = MockEventSource.last();
    await flushAct(() => replacementStream.emitMessage(ticketEvent));
    expect(rerenderedTicketUpdate).not.toHaveBeenCalled();

    tenantId = "tenant-two";
    await hook.rerender();
    const tenantTwoStream = MockEventSource.last();
    expect(replacementStream.closeCount).toBe(1);
    expect(tenantTwoStream).not.toBe(replacementStream);

    await hook.unmount();
    expect(tenantTwoStream.closeCount).toBe(1);
  });

  it("does not open a stream until an authenticated tenant is available", async () => {
    const onOpen = vi.fn();
    const onTicketUpdate = vi.fn();
    const onQueuesUpdate = vi.fn();
    let tenantId: string | null = null;
    const hook = await renderHook(() => useSupportTicketStream({
      tenantId,
      onOpen,
      onTicketUpdate,
      onQueuesUpdate,
    }));

    expect(MockEventSource.instances).toHaveLength(0);
    tenantId = "tenant-one";
    await hook.rerender();
    expect(MockEventSource.instances).toHaveLength(1);
  });
});
