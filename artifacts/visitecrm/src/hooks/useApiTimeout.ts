import { useEffect, useState } from "react";

interface UseApiTimeoutOptions {
  enabled?: boolean;
  timeoutMs?: number;
}

export function useApiTimeout({ enabled = true, timeoutMs = 10_000 }: UseApiTimeoutOptions = {}) {
  const [timedOut, setTimedOut] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    setTimedOut(false);
    const t = setTimeout(() => setTimedOut(true), timeoutMs);
    return () => clearTimeout(t);
  }, [enabled, retryKey, timeoutMs]);

  function reset() {
    setTimedOut(false);
    setRetryKey((k) => k + 1);
  }

  return { timedOut, retryKey, reset };
}
