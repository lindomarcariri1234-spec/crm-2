import { useState, useRef } from "react";
import { useUploadGuard } from "./use-upload-guard";

const UPLOAD_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/upload";

const MAX_RETRIES = 2;

/** Fields always present in an upload result. */
interface UploadBaseResult {
  url: string;
  key: string;
  name: string;
  size?: number;
  mimeType?: string;
}

/**
 * Additional fields returned when `tripId` was supplied and the backend
 * inserted the record into `trip_media` atomically.
 */
interface TripMediaResult extends UploadBaseResult {
  id: string;
  type: string;
  caption: string | null;
  createdAt: string;
}

export type UploadResult = UploadBaseResult | TripMediaResult;

export function isTripMediaResult(r: UploadResult): r is TripMediaResult {
  return "id" in r && typeof (r as TripMediaResult).id === "string";
}

interface UploadCallbacks {
  onBegin?: () => void;
  onComplete?: (result: UploadResult) => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
}

interface MultiUploadCallbacks {
  onBegin?: () => void;
  onComplete?: (results: Array<UploadBaseResult>) => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
}

interface UploadOptions {
  maxSizeMB?: number;
  /**
   * When provided, the backend will insert a `trip_media` record atomically
   * after the upload and return the full record (including `id`, `type`,
   * `caption`, `createdAt`) instead of just `{ url, key, name }`.
   */
  tripId?: string;
  /**
   * Optional caption to store with the `trip_media` record when `tripId` is
   * set. Ignored if `tripId` is not provided. Max 500 chars (enforced server-side).
   */
  caption?: string;
}

class UploadHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "UploadHttpError";
  }
}

function makeAbortError(): Error {
  const err = new Error("Upload cancelado");
  err.name = "AbortError";
  return err;
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return false;
  if (err instanceof UploadHttpError && err.status < 500) return false;
  return true;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  onRetrying: (attempt: number) => void,
  resetProgress: () => void,
  isCancelled: () => boolean
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      resetProgress();
      onRetrying(attempt);
      await new Promise<void>((res) => setTimeout(res, attempt * 1000));
      if (isCancelled()) throw makeAbortError();
    }
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

function xhrUpload<T>(
  url: string,
  form: FormData,
  onProgress: (pct: number, loaded?: number, total?: number) => void,
  xhrRef: React.MutableRefObject<XMLHttpRequest | null>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.open("POST", url);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100), e.loaded, e.total);
      }
    };

    xhr.onload = () => {
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as T);
        } catch {
          reject(new Error("Resposta inválida do servidor"));
        }
      } else {
        let msg = `HTTP ${xhr.status}`;
        try {
          const json = JSON.parse(xhr.responseText) as { error?: string };
          if (json.error) msg = json.error;
        } catch { /* ignore */ }
        reject(new UploadHttpError(xhr.status, msg));
      }
    };

    xhr.onerror = () => {
      xhrRef.current = null;
      reject(new Error("Erro de rede"));
    };

    xhr.onabort = () => {
      xhrRef.current = null;
      reject(makeAbortError());
    };

    xhr.send(form);
  });
}

export function useUploadImage(callbacks: UploadCallbacks = {}, options: UploadOptions = {}) {
  const [isUploading, setIsUploading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const cancelledRef = useRef(false);

  function cancelUpload() {
    cancelledRef.current = true;
    xhrRef.current?.abort();
  }

  const { guardDialog } = useUploadGuard(isUploading, cancelUpload);

  async function startUpload(file: File) {
    cancelledRef.current = false;
    setIsUploading(true);
    setIsRetrying(false);
    setUploadProgress(0);
    callbacks.onBegin?.();
    try {
      const form = new FormData();
      form.append("file", file);
      if (options.maxSizeMB) {
        form.append("maxSizeMB", String(options.maxSizeMB));
      }
      if (options.tripId) {
        form.append("tripId", options.tripId);
      }
      if (options.tripId && options.caption !== undefined && options.caption !== "") {
        form.append("caption", options.caption);
      }
      const data = await withRetry(
        () => xhrUpload<UploadResult>(
          `${UPLOAD_BASE}/image`, form, setUploadProgress, xhrRef
        ),
        () => setIsRetrying(true),
        () => setUploadProgress(0),
        () => cancelledRef.current
      );
      callbacks.onComplete?.(data);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        callbacks.onCancel?.();
        return;
      }
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsUploading(false);
      setIsRetrying(false);
      setUploadProgress(0);
      xhrRef.current = null;
    }
  }

  return { startUpload, isUploading, isRetrying, uploadProgress, cancelUpload, guardDialog };
}

export function useUploadImages(callbacks: MultiUploadCallbacks = {}, options: UploadOptions = {}) {
  const [isUploading, setIsUploading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const cancelledRef = useRef(false);

  function cancelUpload() {
    cancelledRef.current = true;
    xhrRef.current?.abort();
  }

  const { guardDialog } = useUploadGuard(isUploading, cancelUpload);

  async function startUpload(files: File[]) {
    if (!files.length) return;
    cancelledRef.current = false;
    setIsUploading(true);
    setIsRetrying(false);
    setUploadProgress(0);
    callbacks.onBegin?.();
    try {
      const form = new FormData();
      for (const file of files) {
        form.append("files", file);
      }
      if (options.maxSizeMB) {
        form.append("maxSizeMB", String(options.maxSizeMB));
      }
      const data = await withRetry(
        () => xhrUpload<Array<UploadBaseResult>>(
          `${UPLOAD_BASE}/images`, form, setUploadProgress, xhrRef
        ),
        () => setIsRetrying(true),
        () => setUploadProgress(0),
        () => cancelledRef.current
      );
      callbacks.onComplete?.(data);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        callbacks.onCancel?.();
        return;
      }
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsUploading(false);
      setIsRetrying(false);
      setUploadProgress(0);
      xhrRef.current = null;
    }
  }

  return { startUpload, isUploading, isRetrying, uploadProgress, cancelUpload, guardDialog };
}

export function useUploadVideo(callbacks: UploadCallbacks = {}, options: UploadOptions = {}) {
  const SPEED_WINDOW_MS = 3_000;
  const SPEED_UPDATE_INTERVAL_MS = 500;
  const [isUploading, setIsUploading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  /**
   * Estimated seconds remaining for the current upload, or null when unknown.
   * Computed from elapsed wall-clock time + XHR progress fraction.
   * Only non-null once progress > 0 and at least 1 second has elapsed (to
   * avoid wild initial estimates when bytes arrive in bursts).
   */
  const [uploadEta, setUploadEta] = useState<number | null>(null);
  /** Rolling upload speed in bytes per second, or null before enough data exists. */
  const [uploadSpeedBps, setUploadSpeedBps] = useState<number | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const cancelledRef = useRef(false);
  /** Wall-clock ms when the first progress byte was observed; null until then. */
  const startTimeRef = useRef<number | null>(null);
  /** Recent byte-count samples used to avoid a slow-to-converge whole-upload average. */
  const speedSamplesRef = useRef<Array<{ loaded: number; timestamp: number }>>([]);
  /** Timestamp of the most recent speed state update. */
  const lastSpeedUpdateRef = useRef<number | null>(null);

  function cancelUpload() {
    cancelledRef.current = true;
    xhrRef.current?.abort();
  }

  const { guardDialog } = useUploadGuard(isUploading, cancelUpload);

  /** Called on every XHR progress event instead of setUploadProgress directly. */
  function handleProgress(pct: number, loaded?: number, total?: number) {
    const now = Date.now();

    // Capture start time on the first byte received
    if (startTimeRef.current === null && pct > 0) {
      startTimeRef.current = now;
    }
    setUploadProgress(pct);

    if (startTimeRef.current !== null && pct > 0 && pct < 100) {
      const elapsed = (now - startTimeRef.current) / 1000;
      // Wait at least 1 second before estimating to avoid initial burst noise
      if (elapsed >= 1) {
        const rate = (pct / 100) / elapsed; // fraction-of-file per second
        const remaining = 1 - pct / 100;
        const eta = remaining / rate;
        setUploadEta(Number.isFinite(eta) && eta > 0 ? eta : null);
      }
    } else {
      setUploadEta(null);
    }

    if (loaded !== undefined && total !== undefined && total > 0) {
      const samples = speedSamplesRef.current;
      samples.push({ loaded, timestamp: now });

      // Keep one sample as the baseline even if all earlier samples fall out
      // of the window, so the next event can establish a fresh rate.
      const cutoff = now - SPEED_WINDOW_MS;
      while (samples.length > 1 && samples[0].timestamp < cutoff) {
        samples.shift();
      }

      if (lastSpeedUpdateRef.current === null) {
        lastSpeedUpdateRef.current = samples[0].timestamp;
      }

      const shouldUpdate =
        now - lastSpeedUpdateRef.current >= SPEED_UPDATE_INTERVAL_MS || pct >= 100;
      if (shouldUpdate) {
        lastSpeedUpdateRef.current = now;
        const firstSample = samples[0];
        const elapsedMs = now - firstSample.timestamp;
        if (elapsedMs > 0) {
          const speed = ((loaded - firstSample.loaded) / elapsedMs) * 1000;
          setUploadSpeedBps(Number.isFinite(speed) && speed >= 0 ? speed : null);
        } else {
          setUploadSpeedBps(null);
        }
      }
    }
  }

  function resetProgressAndEta() {
    setUploadProgress(0);
    setUploadEta(null);
    setUploadSpeedBps(null);
    startTimeRef.current = null;
    speedSamplesRef.current = [];
    lastSpeedUpdateRef.current = null;
  }

  async function startUpload(file: File) {
    cancelledRef.current = false;
    startTimeRef.current = null;
    setIsUploading(true);
    setIsRetrying(false);
    setUploadProgress(0);
    setUploadEta(null);
    setUploadSpeedBps(null);
    speedSamplesRef.current = [];
    lastSpeedUpdateRef.current = null;
    callbacks.onBegin?.();
    try {
      const form = new FormData();
      form.append("file", file);
      if (options.tripId) {
        form.append("tripId", options.tripId);
      }
      const data = await withRetry(
        () => xhrUpload<UploadResult>(
          `${UPLOAD_BASE}/video`, form, handleProgress, xhrRef
        ),
        () => setIsRetrying(true),
        resetProgressAndEta,
        () => cancelledRef.current
      );
      callbacks.onComplete?.(data);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        callbacks.onCancel?.();
        return;
      }
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsUploading(false);
      setIsRetrying(false);
      setUploadProgress(0);
      setUploadEta(null);
      setUploadSpeedBps(null);
      xhrRef.current = null;
      speedSamplesRef.current = [];
      lastSpeedUpdateRef.current = null;
    }
  }

  return {
    startUpload,
    isUploading,
    isRetrying,
    uploadProgress,
    uploadEta,
    uploadSpeedBps,
    cancelUpload,
    guardDialog,
  };
}

export function useUploadDocument(callbacks: UploadCallbacks = {}) {
  const [isUploading, setIsUploading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const cancelledRef = useRef(false);

  function cancelUpload() {
    cancelledRef.current = true;
    xhrRef.current?.abort();
  }

  const { guardDialog } = useUploadGuard(isUploading, cancelUpload);

  async function startUpload(file: File) {
    cancelledRef.current = false;
    setIsUploading(true);
    setIsRetrying(false);
    setUploadProgress(0);
    callbacks.onBegin?.();
    try {
      const form = new FormData();
      form.append("file", file);
      const data = await withRetry(
        () => xhrUpload<UploadResult>(
          `${UPLOAD_BASE}/document`, form, setUploadProgress, xhrRef
        ),
        () => setIsRetrying(true),
        () => setUploadProgress(0),
        () => cancelledRef.current
      );
      callbacks.onComplete?.(data);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        callbacks.onCancel?.();
        return;
      }
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsUploading(false);
      setIsRetrying(false);
      setUploadProgress(0);
      xhrRef.current = null;
    }
  }

  return { startUpload, isUploading, isRetrying, uploadProgress, cancelUpload, guardDialog };
}
