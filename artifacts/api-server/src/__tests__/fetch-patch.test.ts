import { afterEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.resetModules();
});

describe("UploadThing fetch patch", () => {
  it("removes Range and normalizes one extra percent-encoding layer", async () => {
    const nativeFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = nativeFetch as typeof fetch;

    await import("../lib/fetch-patch.js");

    const signedUrl = "https://sea1.ingest.uploadthing.com/file?type=text%252Fplain&name=Visite%2520Cariri";
    await globalThis.fetch(
      new Request(signedUrl, {
        method: "PUT",
        headers: { Range: "bytes=0-", "x-uploadthing-version": "7.7.4" },
        body: new FormData(),
      }),
    );

    expect(nativeFetch).toHaveBeenCalledTimes(1);
    const call = nativeFetch.mock.calls[0] as unknown[] | undefined;
    const url = call?.[0] as string | undefined;
    const init = call?.[1] as RequestInit | undefined;
    expect(url).toBe("https://sea1.ingest.uploadthing.com/file?type=text%2Fplain&name=Visite%20Cariri");
    expect(new Headers(init?.headers).has("range")).toBe(false);
    expect(new Headers(init?.headers).get("x-uploadthing-version")).toBe("7.7.4");
  });

  it("retries the provider-issued URL when its signer rejects canonical normalization", async () => {
    const nativeFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":"Invalid signature"}', { status: 400 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    globalThis.fetch = nativeFetch as typeof fetch;

    await import("../lib/fetch-patch.js");

    await globalThis.fetch(
      "https://sea1.ingest.uploadthing.com/file?type=text%252Fplain&name=Visite%2520Cariri",
      { method: "PUT", headers: { Range: "bytes=0-" }, body: new FormData() },
    );

    expect(nativeFetch.mock.calls[0]?.[0]).toBe(
      "https://sea1.ingest.uploadthing.com/file?type=text%2Fplain&name=Visite%20Cariri",
    );
    expect(nativeFetch.mock.calls[1]?.[0]).toBe(
      "https://sea1.ingest.uploadthing.com/file?type=text%252Fplain&name=Visite%2520Cariri",
    );
    expect(new Headers(nativeFetch.mock.calls[0]?.[1]?.headers).has("range")).toBe(false);
  });
});