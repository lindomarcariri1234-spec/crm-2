import { StrictMode, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/index.css";
import PerfilPage from "../src/pages/perfil";
import VitrineCatalog from "../src/pages/vitrine/catalog";
import VitrineCalendar from "../src/pages/vitrine/calendar";
import VitrineProduct from "../src/pages/vitrine/product";
import VitrineCheckout from "../src/pages/vitrine/checkout";
import VitrineOrderTracking from "../src/pages/vitrine/order-tracking";
import ReservationWizard from "../src/pages/vitrine/reservation-wizard";
import ReferralLanding from "../src/pages/vitrine/referral-landing";
import VitrineComparar from "../src/pages/vitrine/comparar";
import VitrineSignIn from "../src/pages/vitrine/store-signin";
import VitrineSignUp from "../src/pages/vitrine/store-signup";
import { CartProvider } from "../src/contexts/CartContext";
import { ComparisonProvider } from "../src/contexts/ComparisonContext";
import { FavoritesProvider } from "../src/contexts/FavoritesContext";
import { VitrineThemeProvider } from "../src/contexts/VitrineThemeContext";
import {
  visualCategory,
  visualCreatedOrder,
  visualOrder,
  visualProduct,
  visualProfile,
  visualReferral,
  visualStore,
} from "./fixtures";

const profileReferrals = { data: [visualReferral] };
const favorites = {
  trips: [],
  products: [
    {
      favoriteId: "visual-favorite-fixture",
      productId: visualProduct.id,
      productSlug: visualProduct.slug,
      name: visualProduct.name,
      imageUrl: null,
      price: visualProduct.price,
      salePrice: null,
    },
  ],
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function payloadFor(pathname: string, method: string, requestBody?: unknown): unknown {
  if (pathname === "/api/client/me") return visualProfile;
  if (pathname === "/api/client/me/referrals") return profileReferrals;
  if (pathname === "/api/client/me/referral-campaign") {
    return {
      id: "visual-campaign",
      name: "Campanha de teste",
      startsAt: "2030-01-01T12:00:00.000Z",
      endsAt: "2030-12-31T12:00:00.000Z",
      bonusType: "fixed_bonus",
      bonusValue: 50,
      bannerText: "Indique e viaje",
      shareMessage: "Vamos viajar juntos!",
      materialUrl: null,
    };
  }
  if (pathname === "/api/client/me/favorites") return favorites;
  if (pathname.startsWith("/api/client/me/loyalty/transactions")) {
    return { data: [], hasMore: false, total: 0 };
  }
  if (pathname === "/api/client/me/achievements") {
    return {
      badges: [
        { key: "first-trip", name: "Primeira viagem", description: "Fez sua primeira viagem.", earned: true, earnedAt: "2026-08-01T12:00:00.000Z" },
        { key: "explorer", name: "Explorador", description: "Conheceu novos destinos.", earned: false, earnedAt: null, progress: 1, target: 3 },
      ],
      stats: { totalTrips: 1, visitedStates: ["CE"], uniqueDestinations: ["Nova Olinda"] },
    };
  }
  if (pathname === "/api/client/me/dream-destinations") {
    return { data: [{ id: "visual-dream-fixture", destinationName: "Lençóis Maranhenses", note: "Conhecer as lagoas", createdAt: "2026-08-01T12:00:00.000Z" }] };
  }
  if (pathname === "/api/client/me/memories") {
    return {
      memories: [
        {
          reservationId: "visual-reservation-fixture",
          tripId: "visual-trip-fixture",
          tripName: visualProduct.name,
          tripDestination: "Nova Olinda, CE",
          tripDestinationCity: "Nova Olinda",
          tripDestinationState: "CE",
          tripCoverImage: null,
          tripDepartureDate: "2030-05-15",
          tripReturnDate: "2030-05-18",
          npsSubmitted: false,
          media: [],
        },
      ],
    };
  }
  if (pathname === "/api/club/config") return { clubName: "Clube de Viagens", description: "Benefícios para viajantes." };
  if (pathname === "/api/club/benefits") {
    return { data: [{ id: "visual-benefit", title: "Condições especiais", description: "Ofertas para associados.", active: true }] };
  }
  if (pathname === "/api/club/ranking") {
    return {
      month: "2030-05",
      referrers: [],
      travelers: [],
      totalReferrers: 0,
      totalTravelers: 0,
    };
  }
  if (pathname === "/api/users/me" || pathname === "/api/auth/me") {
    return {
      id: "visual-user-fixture",
      role: "client",
      name: "Viajante de Teste",
      email: "viajante@example.invalid",
      tenant: { id: visualStore.id, slug: visualStore.slug, name: visualStore.name },
    };
  }

  const storePrefix = `/api/public/store/${visualStore.slug}`;
  if (pathname === `${storePrefix}/categories`) return [visualCategory];
  if (pathname === `${storePrefix}/products`) {
    return { data: [visualProduct], total: 1, page: 1, limit: 12 };
  }
  if (pathname === `${storePrefix}/products/${visualProduct.slug}`) {
    return { ...visualProduct, reviews: [] };
  }
  if (pathname === `${storePrefix}/products/${visualProduct.slug}/partner-info`) {
    return { hasPartner: false };
  }
  if (pathname.startsWith(`${storePrefix}/products/${visualProduct.slug}/recommendations`)) {
    return { data: [] };
  }
  if (pathname === `${storePrefix}/reviews`) return [];
  if (pathname.startsWith(`${storePrefix}/orders/`) && method === "GET") return visualOrder;
  if (pathname === `${storePrefix}/orders` && method === "POST") {
    const orderRequest = requestBody as {
      items?: Array<{ quantity?: number; unitPrice?: number }>;
    } | null;
    const totalAmount = orderRequest?.items?.reduce(
      (total, item) => total + (item.quantity ?? 1) * (item.unitPrice ?? 0),
      0,
    ) || Number(visualCreatedOrder.totalAmount);
    return {
      ...visualCreatedOrder,
      subtotal: totalAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      amountRemaining: totalAmount.toFixed(2),
      financialSummary: {
        ...visualCreatedOrder.financialSummary,
        subtotal: totalAmount,
        totalAmount,
        paidAmount: 0,
        amountRemaining: totalAmount,
      },
    };
  }
  if (pathname.startsWith(`${storePrefix}/trips/`) && pathname.endsWith("/seat-map")) {
    return {
      tripId: visualProduct.tripId,
      layout: "2x2",
      floors: 1,
      totalSeats: 24,
      cols: 4,
      seats: [
        { number: "1", row: 1, col: 1, floor: 1, type: "regular", status: "available" },
        { number: "2", row: 1, col: 2, floor: 1, type: "regular", status: "available" },
      ],
    };
  }
  if (pathname === `${storePrefix}/coupons/validate`) {
    return { valid: false, error: "Cupom de teste não aplicado." };
  }
  if (pathname.includes("/referral/info") || pathname.endsWith("/referral/validate")) {
    return {
      valid: true,
      code: "VIAJANTE-TESTE",
      referrerName: "Pessoa de Teste",
      discountAmount: 0,
      bonusAmount: 50,
    };
  }
  if (method === "DELETE") return {};
  if (method !== "GET") return { success: true, id: "visual-fixture" };
  if (pathname.startsWith("/api/public/store/")) return { data: [], total: 0, page: 1, limit: 12 };
  return {};
}

async function readJsonRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  if (typeof init?.body === "string") {
    try {
      return JSON.parse(init.body);
    } catch {
      return null;
    }
  }
  if (input instanceof Request) {
    try {
      return await input.clone().json();
    } catch {
      return null;
    }
  }
  return null;
}

function installFixtureFetch() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const inputUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(inputUrl, window.location.href);
    if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      let requestBody: unknown;
      if (url.pathname === `/api/public/store/${visualStore.slug}/orders` && method === "POST") {
        requestBody = await readJsonRequestBody(input, init);
        window.sessionStorage.setItem("visual-test:last-order-request", JSON.stringify(requestBody));
      }
      return jsonResponse(payloadFor(url.pathname, method, requestBody));
    }
    return nativeFetch(input, init);
  }) as typeof window.fetch;
}

function scenarioElement(scenario: string) {
  if (scenario === "perfil") return createElement(PerfilPage);
  if (scenario === "catalogo") return createElement(VitrineCatalog, { slug: visualStore.slug, store: visualStore });
  if (scenario === "calendario") return createElement(VitrineCalendar, { slug: visualStore.slug, store: visualStore });
  if (scenario === "produto") return createElement(VitrineProduct, { slug: visualStore.slug, productSlug: visualProduct.slug, store: visualStore });
  if (scenario === "checkout") return createElement(VitrineCheckout, { slug: visualStore.slug, store: visualStore });
  if (scenario === "pedido") return createElement(VitrineOrderTracking, { slug: visualStore.slug, store: visualStore });
  if (scenario === "reserva") return createElement(ReservationWizard, { slug: visualStore.slug, productSlug: visualProduct.slug, store: visualStore });
  if (scenario === "indicacao") return createElement(ReferralLanding, { slug: visualStore.slug, store: visualStore });
  if (scenario === "comparar") return createElement(VitrineComparar, { slug: visualStore.slug, store: visualStore });
  if (scenario === "entrar") return createElement(VitrineSignIn, { slug: visualStore.slug, store: visualStore });
  if (scenario === "cadastrar") return createElement(VitrineSignUp, { slug: visualStore.slug, store: visualStore });
  return createElement("p", null, "Cenário de teste desconhecido.");
}

const scenario = new URLSearchParams(window.location.search).get("scenario") ?? "perfil";
const rootElement = document.getElementById("visual-test-root");
if (!rootElement) throw new Error("Elemento raiz dos testes visuais não encontrado.");
installFixtureFetch();
sessionStorage.removeItem("visual-test:last-order-request");

localStorage.setItem(
  `cart_${visualStore.slug}`,
  JSON.stringify([
    {
      productId: visualProduct.id,
      productName: visualProduct.name,
      unitPrice: Number(visualProduct.price),
      quantity: 1,
    },
  ]),
);
localStorage.setItem(
  `compare_${visualStore.slug}`,
  JSON.stringify([
    {
      productId: visualProduct.id,
      productSlug: visualProduct.slug,
      name: visualProduct.name,
      priceAtAdd: Number(visualProduct.price),
    },
  ]),
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});
const storePage = createElement(
  VitrineThemeProvider,
  { store: visualStore },
  createElement(
    CartProvider,
    { slug: visualStore.slug },
    createElement(
      ComparisonProvider,
      { slug: visualStore.slug },
      createElement(FavoritesProvider, null, scenarioElement(scenario)),
    ),
  ),
);

createRoot(rootElement).render(
  createElement(
    StrictMode,
    null,
    createElement(
      QueryClientProvider,
      { client: queryClient },
      scenario === "perfil" ? scenarioElement(scenario) : storePage,
    ),
  ),
);