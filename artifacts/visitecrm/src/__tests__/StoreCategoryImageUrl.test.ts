import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicStoreApi, storeApi } from "../lib/storeApi.js";

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

describe("store category image URLs", () => {
  const imageUrl = "https://utfs.io/f/category-cover.jpg";
  const apiCategory = {
    id: "category-1",
    storeId: "store-1",
    name: "Excursão",
    slug: "excursao",
    image: imageUrl,
    order: 3,
    isActive: true,
    createdAt: "2026-10-18T12:00:00.000Z",
    updatedAt: "2026-10-18T12:00:00.000Z",
  };

  it("sends image and order fields when creating a category", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(apiCategory));

    const category = await storeApi.createCategory({
      name: "Excursão",
      slug: "excursao",
      imageUrl,
      position: 3,
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      image: imageUrl,
      order: 3,
    });
    expect(category).toMatchObject({ imageUrl, position: 3 });
  });

  it("sends an updated image URL and maps the saved category response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(apiCategory));

    const category = await storeApi.updateCategory("category-1", { imageUrl });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ image: imageUrl });
    expect(category.imageUrl).toBe(imageUrl);
  });

  it("maps the public category image URL for storefront rendering", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([apiCategory]));

    const [category] = await publicStoreApi.getCategories("loja-teste");

    expect(category.imageUrl).toBe(imageUrl);
    expect(category.position).toBe(3);
  });
});
