import { describe, expect, it } from "vitest";
import {
  destinationPath,
  destinationSlug,
  findDestination,
  selectFeaturedOrRealProducts,
  selectUpcomingDepartures,
} from "@/pages/vitrine/visite-cariri/portalData";

describe("Visite Cariri portal selections", () => {
  it("keeps featured items first and falls back only to real listed travel products", () => {
    const products = [
      { id: "ordinary-a", isFeatured: false },
      { id: "featured", isFeatured: true },
      { id: "ordinary-b", isFeatured: false },
    ];
    expect(selectFeaturedOrRealProducts(products)).toEqual({
      products: [products[1]],
      usesFallback: false,
    });

    const fallback = selectFeaturedOrRealProducts([products[0], products[2]]);
    expect(fallback.products).toEqual([products[0], products[2]]);
    expect(fallback.usesFallback).toBe(true);
    expect(selectFeaturedOrRealProducts([])).toEqual({ products: [], usesFallback: false });
  });

  it("resolves destination detail routes from curated names and rejects unknown slugs", () => {
    const curated = [
      { name: "Parque Estadual Sítio Fundão", photo: "provided-photo" },
      { name: "Mirante da Macaúba", photo: "provided-photo" },
    ];
    const slug = destinationSlug(curated[0].name);
    expect(slug).toBe("parque-estadual-sitio-fundao");
    expect(destinationPath(slug)).toBe("/loja/visite-cariri/destinos/parque-estadual-sitio-fundao");
    expect(findDestination(slug, curated)).toBe(curated[0]);
    expect(findDestination("invented-destination", curated)).toBeUndefined();
  });

  it("selects only dated today-or-future departures and sorts them by date", () => {
    const products = [
      { id: "later", name: "Mais tarde", slug: "mais-tarde", departureDate: "2026-07-02" },
      { id: "past", name: "Passada", slug: "passada", departureDate: "2026-06-09" },
      { id: "fallback", name: "Data inicial", slug: "data-inicial", startDate: "2026-06-18" },
      { id: "today", name: "Hoje", slug: "hoje", departureDate: "2026-06-10" },
      { id: "missing", name: "Sem data", slug: "sem-data" },
      { id: "invalid", name: "Data inválida", slug: "invalida", departureDate: "2026-02-30", startDate: "2026-06-11" },
    ];
    expect(selectUpcomingDepartures(products, "2026-06-10").map(({ product, date }) => [product.id, date])).toEqual([
      ["today", "2026-06-10"],
      ["fallback", "2026-06-18"],
      ["later", "2026-07-02"],
    ]);
  });
});
