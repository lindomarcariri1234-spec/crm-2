// React's act() warnings are useful in the browser but this test intentionally
// drives a hand-rolled root, matching the existing frontend test harness.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-upload-guard", () => ({
  useUploadGuard: () => ({ guardDialog: null }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children?: React.ReactNode }) =>
    createElement("button", props, children),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    createElement("input", props),
}));

import { VideoGalleryUpload, formatEta, formatUploadSpeed } from "@/components/video-gallery-upload";

type ProgressHandler = (event: {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}) => void;

type MockXhr = {
  open: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  withCredentials: boolean;
  upload: { onprogress: ProgressHandler | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  status: number;
  responseText: string;
};

const roots: Root[] = [];

function makeXhr(): MockXhr {
  return {
    open: vi.fn(),
    send: vi.fn(),
    abort: vi.fn(),
    withCredentials: false,
    upload: { onprogress: null },
    onload: null,
    onerror: null,
    onabort: null,
    status: 200,
    responseText: JSON.stringify({
      url: "https://cdn.example.com/video.mp4",
      key: "video-key",
      name: "video.mp4",
    }),
  };
}

async function renderUpload() {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(createElement(VideoGalleryUpload, { value: [], onChange: vi.fn() }));
  });

  return { container };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(async () => {
  for (const root of roots) {
    await act(async () => root.unmount());
  }
  roots.length = 0;
  vi.useRealTimers();
});

describe("formatEta", () => {
  it.each([
    [null, ""],
    [5, "< 10s"],
    [30, "~30s"],
    [90, "~1min 30s"],
    [600, "~10min"],
    [Infinity, ""],
    [NaN, ""],
  ])("formats %s as %s", (seconds, expected) => {
    expect(formatEta(seconds)).toBe(expected);
  });
});

describe("formatUploadSpeed", () => {
  it.each([
    [null, ""],
    [0, "0.0 MB/s"],
    [1024 * 1024, "1.0 MB/s"],
    [0.3 * 1024 * 1024, "0.3 MB/s"],
    [Infinity, ""],
    [NaN, ""],
  ])("formats %s as %s", (bytesPerSecond, expected) => {
    expect(formatUploadSpeed(bytesPerSecond)).toBe(expected);
  });
});

describe("VideoGalleryUpload upload progress", () => {
  it("shows no invalid ETA during the initial burst, then displays the slow-upload estimate", async () => {
    const xhr = makeXhr();
    const OriginalXHR = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = vi.fn().mockReturnValue(xhr) as unknown as typeof XMLHttpRequest;

    try {
      const { container } = await renderUpload();
      const fileInput = container.querySelector('input[type="file"]');
      expect(fileInput).not.toBeNull();

      const file = new File(["video bytes"], "video.mp4", { type: "video/mp4" });
      Object.defineProperty(fileInput, "files", {
        configurable: true,
        value: [file],
      });

      await act(async () => {
        fileInput!.dispatchEvent(new Event("change", { bubbles: true }));
        await Promise.resolve();
      });

      expect(xhr.send).toHaveBeenCalledOnce();
      expect(container.textContent).toContain("Enviando...");

      await act(async () => {
        xhr.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 100 });
      });
      expect(container.textContent).toContain("Enviando 10%");
      expect(container.textContent).not.toContain("restantes");
      expect(container.textContent).not.toMatch(/Infinity|NaN/);

      vi.setSystemTime(30_000);
      await act(async () => {
        xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      });

      expect(container.textContent).toContain("Enviando 50% · ~30s");
      expect(container.textContent).toContain("~30s restantes");
      expect(container.textContent).not.toMatch(/Infinity|NaN/);

      await act(async () => {
        xhr.onload?.();
        await Promise.resolve();
      });
    } finally {
      globalThis.XMLHttpRequest = OriginalXHR;
    }
  });

  it("shows short-window speed alongside ETA after progress has been sampled for about 500ms", async () => {
    const xhr = makeXhr();
    const OriginalXHR = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = vi.fn().mockReturnValue(xhr) as unknown as typeof XMLHttpRequest;

    try {
      const { container } = await renderUpload();
      const fileInput = container.querySelector('input[type="file"]');
      const file = new File(["video bytes"], "video.mp4", { type: "video/mp4" });
      Object.defineProperty(fileInput, "files", {
        configurable: true,
        value: [file],
      });

      await act(async () => {
        fileInput!.dispatchEvent(new Event("change", { bubbles: true }));
        await Promise.resolve();
        xhr.upload.onprogress?.({
          lengthComputable: true,
          loaded: 256 * 1024,
          total: 4 * 1024 * 1024,
        });
      });
      expect(container.textContent).not.toContain("MB/s");

      vi.setSystemTime(1_000);
      await act(async () => {
        xhr.upload.onprogress?.({
          lengthComputable: true,
          loaded: 1280 * 1024,
          total: 4 * 1024 * 1024,
        });
      });

      expect(container.textContent).toContain("1.0 MB/s");
      expect(container.textContent).toContain("< 10s restantes");

      await act(async () => {
        xhr.onload?.();
        await Promise.resolve();
      });
    } finally {
      globalThis.XMLHttpRequest = OriginalXHR;
    }
  });
});