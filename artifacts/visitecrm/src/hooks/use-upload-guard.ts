import { useState, useCallback, useRef, useEffect, createElement } from "react";
import type { ReactNode } from "react";
import { UploadGuardDialog } from "./UploadGuardDialog";

const BEFOREUNLOAD_MSG = "Você tem um envio em andamento. Tem certeza que deseja sair?";

interface PendingNav {
  onConfirm: () => void;
}

// ─── Module-level state ───────────────────────────────────────────────────────
// The history patch is reference-counted and shared across all hook instances.
// Only installed when the first upload starts; removed when the last ends.
let activeUploads = 0;
let savedPushState: typeof history.pushState | null = null;
let savedReplaceState: typeof history.replaceState | null = null;
let popstateHandler: ((event: PopStateEvent) => void) | null = null;
let guardedHref: string | null = null;

// Counts synthetic PopStateEvents we dispatch ourselves so the handler can skip them.
let syntheticPops = 0;

// Callback registered by the active hook instance to show the React dialog.
let showDialogFn: ((pending: PendingNav) => void) | null = null;

function dispatchSyntheticPopstate(href: string): void {
  syntheticPops++;
  // Update the URL silently (no popstate), then fire a synthetic popstate so wouter re-renders.
  savedPushState!(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
}

function installHistoryGuard(showDialog: (pending: PendingNav) => void): void {
  showDialogFn = showDialog;
  if (savedPushState !== null) return; // already patched

  savedPushState = history.pushState.bind(history);
  savedReplaceState = history.replaceState.bind(history);
  guardedHref = location.href;

  // Intercept wouter Link / navigate() calls.
  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    if (activeUploads > 0) {
      showDialogFn?.({
        onConfirm: () => {
          savedPushState!(...args);
          guardedHref = location.href;
        },
      });
      return; // block until user decides
    }
    savedPushState!(...args);
    guardedHref = location.href;
  };

  // Intercept replace-based navigation (e.g. wouter { replace: true }).
  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    if (activeUploads > 0) {
      showDialogFn?.({
        onConfirm: () => {
          savedReplaceState!(...args);
          guardedHref = location.href;
        },
      });
      return;
    }
    savedReplaceState!(...args);
    guardedHref = location.href;
  };

  // Intercept browser back/forward in the CAPTURE phase so our handler runs before
  // wouter's bubble-phase listener. When guarding, we call stopImmediatePropagation()
  // on the original event — wouter never sees it — then dispatch a synthetic popstate
  // at the guarded URL so wouter re-renders the correct page. This eliminates the
  // one-frame flash that occurred when wouter processed the original event first.
  popstateHandler = (event: PopStateEvent) => {
    if (syntheticPops > 0) {
      // Our own synthetic event — let it propagate normally so wouter can process it.
      syntheticPops--;
      return;
    }
    if (activeUploads === 0) {
      guardedHref = location.href;
      return;
    }

    // Stop the original event here: wouter must not see it or it will render newHref.
    event.stopImmediatePropagation();

    const newHref = location.href;
    // Restore previous URL and tell wouter to re-render it via a synthetic popstate
    // (which we allow through — syntheticPops guard above lets it reach wouter).
    dispatchSyntheticPopstate(guardedHref ?? location.href);

    showDialogFn?.({
      onConfirm: () => {
        // User confirmed leaving — navigate to where they tried to go.
        dispatchSyntheticPopstate(newHref);
        guardedHref = newHref;
      },
    });
  };

  window.addEventListener("popstate", popstateHandler, { capture: true });
}

function removeHistoryGuard(): void {
  showDialogFn = null;
  if (savedPushState === null) return;

  // Remove the own properties we installed so the original prototype methods are
  // exposed again. Using `delete` avoids accumulating .bind() wrappers if the
  // guard is installed and removed multiple times in the same session.
  delete (history as unknown as Record<string, unknown>).pushState;
  delete (history as unknown as Record<string, unknown>).replaceState;
  savedPushState = null;
  savedReplaceState = null;

  if (popstateHandler) {
    window.removeEventListener("popstate", popstateHandler, { capture: true });
    popstateHandler = null;
  }

  guardedHref = null;
  syntheticPops = 0;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Warns the user before leaving the page while an upload is in progress.
 *
 * Returns `{ guardDialog }` — a ReactNode that must be rendered by the consumer
 * to make the in-app confirmation dialog appear.
 *
 * Coverage:
 * - Tab close / page refresh / external URL → `beforeunload` (native browser prompt,
 *   the only mechanism browsers allow for those events).
 * - In-app navigation via wouter Link / navigate() → patched `history.pushState` /
 *   `replaceState` blocks the call and triggers the React dialog instead.
 * - Browser back/forward within SPA history → `popstate` listener immediately
 *   restores the previous URL (via synthetic popstate so wouter re-renders), then
 *   shows the React dialog; confirming re-dispatches to the target URL.
 *
 * Multiple simultaneous instances are safe: the history patch is reference-counted.
 */
export function useUploadGuard(
  isUploading: boolean,
  onConfirmLeave?: () => void,
): { guardDialog: ReactNode } {
  const [pendingNav, setPendingNav] = useState<PendingNav | null>(null);
  const wasUploadingRef = useRef(false);
  const onConfirmLeaveRef = useRef(onConfirmLeave);
  useEffect(() => { onConfirmLeaveRef.current = onConfirmLeave; });

  const showDialog = useCallback((pending: PendingNav) => {
    setPendingNav(pending);
  }, []);

  // Browser tab close, page refresh, external URL navigation — native prompt only.
  useEffect(() => {
    if (!isUploading) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = BEFOREUNLOAD_MSG;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isUploading]);

  // In-app navigation + browser back/forward.
  useEffect(() => {
    if (isUploading === wasUploadingRef.current) return;
    wasUploadingRef.current = isUploading;

    if (isUploading) {
      if (activeUploads++ === 0) installHistoryGuard(showDialog);
    } else {
      activeUploads = Math.max(0, activeUploads - 1);
      if (activeUploads === 0) removeHistoryGuard();
    }
  }, [isUploading, showDialog]);

  // Safety net: clean up if the component unmounts while still uploading.
  useEffect(() => {
    return () => {
      if (wasUploadingRef.current) {
        wasUploadingRef.current = false;
        activeUploads = Math.max(0, activeUploads - 1);
        if (activeUploads === 0) removeHistoryGuard();
      }
    };
  }, []);

  const handleConfirm = () => {
    const nav = pendingNav;
    setPendingNav(null);
    onConfirmLeaveRef.current?.();
    nav?.onConfirm();
  };

  const handleCancel = () => setPendingNav(null);

  // Use createElement to avoid JSX in a .ts file.
  const guardDialog: ReactNode = createElement(UploadGuardDialog, {
    open: pendingNav !== null,
    onConfirm: handleConfirm,
    onCancel: handleCancel,
  });

  return { guardDialog };
}
