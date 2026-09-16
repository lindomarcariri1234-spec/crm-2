import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanupRoots, renderComponent } from "./eventSourceHarness.js";

const mockUseListAccommodations = vi.hoisted(() => vi.fn());
const mockRefetch = vi.hoisted(() => vi.fn());
const mockMutation = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListAccommodations: mockUseListAccommodations,
  useCreateAccommodation: vi.fn(() => mockMutation),
  useUpdateAccommodation: vi.fn(() => mockMutation),
  useDeleteAccommodation: vi.fn(() => mockMutation),
}));

vi.mock("@/components/gallery-upload", () => ({
  GalleryUpload: () => null,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import Hospedagens from "../pages/cadastros/hospedagens.js";

beforeEach(() => {
  mockUseListAccommodations.mockReturnValue({
    data: [{
      id: "accommodation-1",
      name: "Pousada do Cariri",
      type: "Pousada",
      city: "Crato",
      state: "CE",
      contactName: "Ana",
      totalRooms: 12,
      pricePerNight: "180.00",
      rating: null,
      status: "active",
      gallery: [],
      coverImage: null,
    }],
    isError: false,
    refetch: mockRefetch,
  });
});

afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
});

describe("Hospedagens page", () => {
  it("keeps the help, table, search and current row actions available", async () => {
    const handle = await renderComponent(createElement(Hospedagens));

    expect(handle.container.querySelector('[data-testid="panel-hospedagens-help"]')).not.toBeNull();
    expect(handle.container.querySelector('[data-testid="input-search-hospedagens"]')).not.toBeNull();
    expect(handle.container.querySelector('[data-testid="button-new-hospedagem"]')).not.toBeNull();
    expect(handle.container.querySelector("table")).not.toBeNull();
    expect(handle.container.textContent).toContain("Pousada do Cariri");
    expect(handle.container.querySelector('button[aria-label="Editar Pousada do Cariri"]')).not.toBeNull();
    expect(handle.container.querySelector('button[aria-label="Excluir Pousada do Cariri"]')).not.toBeNull();
  });
});