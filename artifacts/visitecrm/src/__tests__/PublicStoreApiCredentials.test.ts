import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicStoreApi } from "../lib/storeApi.js";

const fetchMock = vi.fn();

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public storefront API credentials", () => {
  it("sends the optional Clerk session when creating an order", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ orderId: "order-001" }));

    await publicStoreApi.createOrder("loja-teste", {
      customerName: "Maria Souza",
      customerEmail: "maria@example.com",
      items: [{ productId: "product-001", quantity: 1 }],
      paymentMethod: "cash",
      referralCreditUsed: 10,
    } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/store/loja-teste/orders",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });

  it("keeps anonymous public product requests working with no session cookie", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
    }));

    await publicStoreApi.getProducts("loja-teste");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/store/loja-teste/products",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
      }),
    );
  });
});