import { describe, expect, it, vi } from "vitest";

const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }));

vi.mock("@workspace/db", () => ({
  db: { select: mockSelect },
  storeProductsTable: {},
  tripsTable: {},
  partnerProductsTable: {},
  partnersTable: {},
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((...args: unknown[]) => args),
}));

import { prepareCheckoutItems, resolveCheckoutUnitPrice } from "../services/checkout/items.js";

const product = {
  id: "product-1",
  name: "Pacote",
  price: "100.00",
  salePrice: null,
  onSale: false,
  tripId: "trip-1",
  trackInventory: false,
  allowBackorder: false,
  hasVariants: true,
  variants: [
    { name: "Quarto", options: [{ label: "Standard", price: 100 }, { label: "Suíte", price: 175 }] },
    { name: "Transporte", options: [{ label: "Standard", price: 120 }] },
  ],
} as unknown as Parameters<typeof resolveCheckoutUnitPrice>[0];

describe("checkout variant pricing", () => {
  it("uses the stored option price instead of the client-provided base price", () => {
    expect(resolveCheckoutUnitPrice(product, {
      variantName: "Quarto",
      variantLabel: "Suíte",
    })).toBe(175);
  });

  it("uses the variant name to disambiguate repeated option labels", () => {
    expect(resolveCheckoutUnitPrice(product, {
      variantName: "Transporte",
      variantLabel: "Standard",
    })).toBe(120);
  });

  it("rejects missing, unknown, or ambiguous variant selections", () => {
    expect(() => resolveCheckoutUnitPrice(product, {}))
      .toThrowError(expect.objectContaining({ code: "PRODUCT_VARIANT_REQUIRED" }));
    expect(() => resolveCheckoutUnitPrice(product, {
      variantName: "Quarto",
      variantLabel: "Premium",
    })).toThrowError(expect.objectContaining({ code: "INVALID_PRODUCT_VARIANT" }));
    expect(() => resolveCheckoutUnitPrice(product, { variantLabel: "Standard" }))
      .toThrowError(expect.objectContaining({ code: "INVALID_PRODUCT_VARIANT" }));
  });

  it("continues to honor the active sale price for products without variants", () => {
    expect(resolveCheckoutUnitPrice({
      ...product,
      onSale: true,
      salePrice: "80.00",
      hasVariants: false,
    } as Parameters<typeof resolveCheckoutUnitPrice>[0], {})).toBe(80);
  });

  it("uses variant prices for trip reservation totals as well as the order subtotal", async () => {
    const chainFor = (rows: unknown[]) => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(rows),
    });
    mockSelect
      .mockImplementationOnce(() => chainFor([product]))
      .mockImplementationOnce(() => chainFor([{ availableSeats: 10, status: "upcoming" }]));

    const prepared = await prepareCheckoutItems({
      storeId: "store-1",
      tenantId: "tenant-1",
      items: [
        { productId: "product-1", quantity: 1, variantName: "Quarto", variantLabel: "Standard" },
        { productId: "product-1", quantity: 1, variantName: "Quarto", variantLabel: "Suíte" },
      ],
    });

    expect(prepared.subtotal).toBe(275);
    expect(prepared.tripLinkedProducts.get("trip-1")).toMatchObject({
      totalQty: 2,
      totalValue: 275,
    });
  });
});
