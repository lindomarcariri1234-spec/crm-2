import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";

import {
  MockEventSource,
  installMockEventSource,
  restoreEventSource,
  renderComponent,
  cleanupRoots,
  flushAct,
} from "./eventSourceHarness.js";

// The component reads the stream URL from clientPortalApi and reports new
// notifications through useToast. Mock both so the test owns the stream URL and
// can observe toasts without rendering the real toast viewport.
const STREAM_URL = "/api/client/notifications/stream";
const markAllNotificationsRead = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/clientPortalApi", () => ({
  clientPortalApi: {
    getNotificationStreamUrl: () => STREAM_URL,
    markAllNotificationsRead: () => markAllNotificationsRead(),
  },
}));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

import { NotificationBell } from "../components/vitrine/NotificationBell.js";

function notification(overrides: Record<string, unknown> = {}) {
  return {
    type: "notification",
    data: {
      id: "n-1",
      type: "referral_converted",
      payload: { referredName: "Maria" },
      readAt: null,
      createdAt: new Date().toISOString(),
      unreadCount: 1,
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  installMockEventSource();
  toast.mockClear();
  markAllNotificationsRead.mockClear();
});

afterEach(async () => {
  await cleanupRoots();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  restoreEventSource();
});

describe("NotificationBell — SSE wiring", () => {
  it("opens the notifications stream with credentials on mount", async () => {
    await renderComponent(createElement(NotificationBell));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.last().url).toBe(STREAM_URL);
    expect(MockEventSource.last().withCredentials).toBe(true);
  });

  it("renders the unread badge from an init event", async () => {
    const { container } = await renderComponent(createElement(NotificationBell));

    await flushAct(() =>
      MockEventSource.last().emitMessage(
        JSON.stringify({
          type: "init",
          data: {
            notifications: [
              {
                id: "n-1",
                type: "referral_converted",
                payload: {},
                readAt: null,
                createdAt: new Date().toISOString(),
              },
            ],
            unreadCount: 3,
          },
        }),
      ),
    );

    const badge = container.querySelector("button span");
    expect(badge?.textContent).toBe("3");
  });

  it("caps the unread badge display at 9+", async () => {
    const { container } = await renderComponent(createElement(NotificationBell));

    await flushAct(() =>
      MockEventSource.last().emitMessage(
        JSON.stringify({ type: "init", data: { notifications: [], unreadCount: 25 } }),
      ),
    );

    expect(container.querySelector("button span")?.textContent).toBe("9+");
  });

  it("updates the badge and fires a toast on a new notification event", async () => {
    const { container } = await renderComponent(createElement(NotificationBell));

    await flushAct(() =>
      MockEventSource.last().emitMessage(JSON.stringify(notification({ unreadCount: 2 }))),
    );

    expect(container.querySelector("button span")?.textContent).toBe("2");
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Maria usou seu código e reservou!",
      }),
    );
  });

  it("does not duplicate a notification with an id already present", async () => {
    const { container } = await renderComponent(createElement(NotificationBell));

    await flushAct(() =>
      MockEventSource.last().emitMessage(JSON.stringify(notification({ unreadCount: 1 }))),
    );
    await flushAct(() =>
      MockEventSource.last().emitMessage(JSON.stringify(notification({ unreadCount: 1 }))),
    );

    // Open the dropdown to inspect the rendered list count.
    const button = container.querySelector("button")!;
    await flushAct(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toContain("1 recentes");
  });

  it("clears the unread badge on an all_read event", async () => {
    const { container } = await renderComponent(createElement(NotificationBell));

    await flushAct(() =>
      MockEventSource.last().emitMessage(
        JSON.stringify({ type: "init", data: { notifications: [], unreadCount: 5 } }),
      ),
    );
    expect(container.querySelector("button span")?.textContent).toBe("5");

    await flushAct(() =>
      MockEventSource.last().emitMessage(JSON.stringify({ type: "all_read", data: {} })),
    );

    expect(container.querySelector("button span")).toBeNull();
  });

  it("ignores malformed (non-JSON) events without throwing", async () => {
    const { container } = await renderComponent(createElement(NotificationBell));

    await flushAct(() => MockEventSource.last().emitMessage("not-json{"));

    expect(container.querySelector("button span")).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it("reconnects 5s after an error by opening a fresh stream", async () => {
    await renderComponent(createElement(NotificationBell));
    const first = MockEventSource.last();

    await flushAct(() => first.emitError());
    expect(first.closeCount).toBe(1);
    expect(MockEventSource.instances).toHaveLength(1);

    await flushAct(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.last().url).toBe(STREAM_URL);
  });

  it("closes the stream on unmount (no leaked connection)", async () => {
    const handle = await renderComponent(createElement(NotificationBell));
    const es = MockEventSource.last();

    await handle.unmount();

    expect(es.closeCount).toBe(1);
  });

  it("does not open a new stream when unmounted before the 5s reconnect fires", async () => {
    const handle = await renderComponent(createElement(NotificationBell));
    const first = MockEventSource.last();

    // A network hiccup schedules a reconnect 5s out.
    await flushAct(() => first.emitError());
    expect(first.closeCount).toBe(1);
    expect(MockEventSource.instances).toHaveLength(1);

    // User navigates away before the reconnect timer fires.
    await handle.unmount();

    // Advancing past the reconnect window must NOT create a leaked connection.
    await flushAct(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(MockEventSource.instances).toHaveLength(1);
  });
});
