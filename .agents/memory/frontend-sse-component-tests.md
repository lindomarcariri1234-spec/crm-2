---
name: Frontend SSE component tests
description: How the visitecrm frontend unit-tests EventSource (SSE) consumers, and two gotchas that cause infinite hangs / JSX errors.
---

# Frontend SSE component/hook tests

The visitecrm Vitest suite (jsdom) tests every SSE consumer with a shared stub:
`artifacts/visitecrm/src/__tests__/eventSourceHarness.ts` exports `MockEventSource`
(records instances, drives `emitOpen/emitMessage/emitError`), `install/restoreEventSource`,
and `renderComponent` / `renderHook` (createRoot + React 19 `act`, no @testing-library/react).
Used by `useSeatStream.test.ts`, `NotificationBell.test.ts`, `BoardingControlPage.test.ts`.

## Gotcha 1 — mocked hooks must return STABLE references
**Rule:** when `vi.mock`-ing `@/hooks/use-toast` or `wouter` for a component whose
`useCallback`/`useEffect` deps include the mocked value, return a module-level constant
(e.g. `const toast = vi.fn(); useToast: () => ({ toast })`), NOT a fresh object per call
(`useToast: () => ({ toast: vi.fn() })`).
**Why:** BoardingControlPage's `fetchData` is `useCallback(..., [tripId, toast])`. A new `toast`
identity each render → new `fetchData` → its effects (fetch + SSE open/close) re-run every render
→ setState → infinite render loop → `act()` never settles → every test times out at 5000ms
(looks like a render hang, not an assertion failure).
**How to apply:** any component test that renders a real component (not a pure hook) and mocks a
hook used in a dependency array.

## Gotcha 2 — JSX needs the automatic runtime in vitest
`artifacts/visitecrm/vitest.config.ts` sets `esbuild: { jsx: "automatic", jsxImportSource: "react" }`.
Without it, rendering real `.tsx` (which never `import React`) throws `ReferenceError: React is not defined`.
Pure-function/hook tests didn't need it; component-render tests do.
