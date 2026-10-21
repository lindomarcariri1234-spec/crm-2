import { afterEach, describe, expect, it, vi } from "vitest";
import { publicStoreApi } from "../lib/storeApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storefront analytics API client", () => {
  it("accepts the endpoint's empty 204 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(publicStoreApi.trackAnalyticsEvent("cariri", {
      event: "page_view",
      pageType: "home",
      group: "unknown",
    })).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/public/store/cariri/analytics"),
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
  });
});
