import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRoots, renderComponent } from "./eventSourceHarness.js";

const mocks = vi.hoisted(() => ({
  getProduct: vi.fn(),
  getPartnerInfo: vi.fn(),
  getRecommendations: vi.fn(),
  getProducts: vi.fn(),
  navigate: vi.fn(),
  toggleFavorite: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/loja/loja-teste/produtos/viagem-teste", mocks.navigate],
}));

vi.mock("@/lib/storeApi", () => ({
  publicStoreApi: {
    getProduct: mocks.getProduct,
    getPartnerInfo: mocks.getPartnerInfo,
    getRecommendations: mocks.getRecommendations,
    getProducts: mocks.getProducts,
  },
}));

vi.mock("@/contexts/VitrineThemeContext", () => ({
  useVitrineTheme: () => ({
    colors: {
      primary: "#1e5b8c",
      accent: "#d8a646",
      accentForeground: "#1f2937",
    },
  }),
}));

vi.mock("@/contexts/FavoritesContext", () => ({
  useFavorites: () => ({
    isFavorited: () => false,
    toggleFavorite: mocks.toggleFavorite,
  }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children?: React.ReactNode }) =>
    createElement("button", props, children),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...props }: { children?: React.ReactNode }) =>
    createElement("span", props, children),
}));

vi.mock("@/components/vitrine/SectionHeader", () => ({
  SectionHeader: () => null,
}));

vi.mock("@/components/vitrine/PremiumProductCard", () => ({
  PremiumProductCard: () => null,
}));

vi.mock("@/components/vitrine/InstallmentSimulator", () => ({
  InstallmentSimulator: () => null,
}));

vi.mock("@/components/vitrine/PriceAlert", () => ({
  PriceAlert: () => null,
}));

import VitrineProduct from "../pages/vitrine/product.js";

function makeProduct(tripVideos: string[] | null) {
  return {
    id: "product-1",
    type: "excursion",
    name: "Viagem teste",
    slug: "viagem-teste",
    price: "350",
    onSale: false,
    trackInventory: false,
    hasDates: false,
    images: [],
    gallery: [],
    features: [],
    includes: [],
    excludes: [],
    requirements: [],
    hasVariants: false,
    variants: [],
    isFeatured: false,
    tripVideos,
    reviews: [],
  };
}

const store = {
  id: "store-1",
  name: "Loja teste",
  slug: "loja-teste",
  primaryColor: "#1e5b8c",
  secondaryColor: "#4c8b5f",
  accentColor: "#d8a646",
} as never;

async function renderProduct(tripVideos: string[] | null) {
  mocks.getProduct.mockResolvedValue(makeProduct(tripVideos));

  const handle = await renderComponent(
    createElement(VitrineProduct, {
      slug: "loja-teste",
      productSlug: "viagem-teste",
      store,
    }),
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  return handle;
}

beforeEach(() => {
  mocks.getPartnerInfo.mockResolvedValue({ hasPartner: false });
  mocks.getRecommendations.mockResolvedValue({ data: [] });
  mocks.getProducts.mockResolvedValue({ data: [] });
});

afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
});

describe("VitrineProduct — trip videos", () => {
  it("renders a native video when the product has a direct trip video URL", async () => {
    const { container } = await renderProduct(["https://example.com/a.mp4"]);

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe("https://example.com/a.mp4");
  });

  it("does not render a video section when the product has no trip videos", async () => {
    const { container } = await renderProduct([]);

    expect(container.querySelector("video")).toBeNull();
    expect(container.textContent).not.toContain("Vídeos da Viagem");
  });
});