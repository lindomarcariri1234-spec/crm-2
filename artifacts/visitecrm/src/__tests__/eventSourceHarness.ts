import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Shared test harness for the frontend's EventSource (SSE) consumers.
//
// jsdom does not implement EventSource, so we stub it. Instances are recorded so
// a test can inspect the URL/options the consumer used and drive its handlers.
// This is the same lightweight pattern first established for useSeatStream; it is
// extracted here because three different screens now consume SSE in tests
// (useSeatStream, NotificationBell, BoardingControlPage).
export class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  withCredentials: boolean;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closeCount = 0;

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.withCredentials = Boolean(init?.withCredentials);
    MockEventSource.instances.push(this);
  }

  get closed(): boolean {
    return this.closeCount > 0;
  }

  close(): void {
    this.closeCount += 1;
  }

  emitOpen(): void {
    this.onopen?.({});
  }

  emitMessage(data: string): void {
    this.onmessage?.({ data });
  }

  emitError(): void {
    this.onerror?.({});
  }

  static reset(): void {
    MockEventSource.instances = [];
  }

  static last(): MockEventSource {
    const es = MockEventSource.instances[MockEventSource.instances.length - 1];
    if (!es) throw new Error("no EventSource was created");
    return es;
  }
}

// React 19's act() requires this flag to flush effects without warnings.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const eventSourceHost = globalThis as unknown as { EventSource?: unknown };
let originalEventSource: unknown;
let saved = false;

// Install the stub on globalThis and clear any recorded instances. Call from
// beforeEach.
export function installMockEventSource(): void {
  if (!saved) {
    originalEventSource = eventSourceHost.EventSource;
    saved = true;
  }
  MockEventSource.reset();
  eventSourceHost.EventSource = MockEventSource;
}

// Restore the original (usually absent) EventSource. Call from afterEach.
export function restoreEventSource(): void {
  if (!saved) return;
  if (originalEventSource === undefined) {
    delete eventSourceHost.EventSource;
  } else {
    eventSourceHost.EventSource = originalEventSource;
  }
  saved = false;
}

// Roots created during a test are auto-unmounted in afterEach so an effect from
// one test can never leak into the next.
const activeRoots: Root[] = [];

export interface RenderHandle {
  container: HTMLElement;
  rerender: (element: ReactElement) => Promise<void>;
  unmount: () => Promise<void>;
}

// Minimal render helper so we don't pull in @testing-library/react: render an
// element into a throwaway, tracked root.
export async function renderComponent(element: ReactElement): Promise<RenderHandle> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  activeRoots.push(root);
  await act(async () => {
    root.render(element);
  });

  return {
    container,
    rerender: async (next: ReactElement) => {
      await act(async () => {
        root.render(next);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

// renderHook variant: render an arbitrary hook inside a throwaway component and
// expose its latest return value. `useHook` is re-read on every rerender, so a
// closure capturing mutable props can drive re-renders.
export async function renderHook<T>(useHook: () => T): Promise<{
  result: { current: T };
  rerender: () => Promise<void>;
  unmount: () => Promise<void>;
}> {
  const result = { current: undefined as unknown as T };

  function TestComponent() {
    result.current = useHook();
    return null;
  }

  const handle = await renderComponent(createElement(TestComponent));

  return {
    result,
    rerender: () => handle.rerender(createElement(TestComponent)),
    unmount: handle.unmount,
  };
}

// Run a synchronous mutation (e.g. driving a MockEventSource handler) inside
// act() so React flushes the resulting state updates.
export async function flushAct(fn: () => void | Promise<void>): Promise<void> {
  await act(async () => {
    await fn();
  });
}

export async function cleanupRoots(): Promise<void> {
  for (const root of activeRoots) {
    await act(async () => {
      root.unmount();
    });
  }
  activeRoots.length = 0;
}
