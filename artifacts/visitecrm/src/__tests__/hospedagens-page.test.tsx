import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";

const mockUseListAccommodations = vi.hoisted(() => vi.fn());
const mockRefetch = vi.hoisted(() => vi.fn());
const mockMutation = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));
const mockRoomQuery = vi.hoisted(() => ({
  data: [],
  refetch: vi.fn(),
  isLoading: false,
}));
const mockAuditQuery = vi.hoisted(() => ({
  data: [],
  refetch: vi.fn(),
  isLoading: false,
  isError: false,
}));
const mockToast = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  useListAccommodations: mockUseListAccommodations,
  useListAccommodationRooms: vi.fn(() => mockRoomQuery),
  useCreateAccommodationRoom: vi.fn(() => mockMutation),
  useUpdateAccommodationRoom: vi.fn(() => mockMutation),
  useDeleteAccommodationRoom: vi.fn(() => mockMutation),
  useListAuditLogs: vi.fn(() => mockAuditQuery),
  useCreateAccommodation: vi.fn(() => mockMutation),
  useUpdateAccommodation: vi.fn(() => mockMutation),
  useDeleteAccommodation: vi.fn(() => mockMutation),
}));

vi.mock("@/components/gallery-upload", () => ({
  GalleryUpload: () => null,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import Hospedagens from "../pages/cadastros/hospedagens.js";

beforeEach(() => {
  mockRoomQuery.data = [];
  mockRoomQuery.refetch.mockReset();
  mockAuditQuery.refetch.mockReset();
  mockMutation.mutateAsync.mockReset();
  mockMutation.mutateAsync.mockResolvedValue(undefined);
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
       gallery: ["https://example.com/pousada.jpg"],
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
    expect(handle.container.querySelector('button[aria-label="Gerenciar quartos de Pousada do Cariri"]')).not.toBeNull();
    expect(handle.container.querySelector('button[aria-label="Ver fotos de Pousada do Cariri"]')).not.toBeNull();
  });

  it("keeps the room visible and hides database details when deleting fails", async () => {
    mockRoomQuery.data = [{
      id: "room-1",
      name: "101",
      category: "standard",
      capacity: 2,
      pricePerNight: null,
      occupied: 0,
      status: "active",
    }];
    mockMutation.mutateAsync.mockRejectedValue(new Error("connection string and SQL details"));

    const handle = await renderComponent(createElement(Hospedagens));
    await flushAct(() => {
      handle.container.querySelector('button[aria-label="Gerenciar quartos de Pousada do Cariri"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flushAct(() => {
      document.body.querySelector('button[aria-label="Excluir quarto 101"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(document.body.textContent).toContain("101");
    expect(mockRoomQuery.refetch).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Não foi possível excluir o quarto. A exclusão não foi aplicada. Tente novamente.",
      variant: "destructive",
    }));
    expect(mockToast.mock.calls.flat().join(" ")).not.toContain("connection string");
  });

  it("keeps the room form state and gives a safe save error when editing fails", async () => {
    mockRoomQuery.data = [{
      id: "room-1",
      name: "101",
      category: "standard",
      capacity: 2,
      pricePerNight: null,
      occupied: 0,
      status: "active",
    }];
    mockMutation.mutateAsync.mockRejectedValue(new Error("database host unavailable"));

    const handle = await renderComponent(createElement(Hospedagens));
    await flushAct(() => {
      handle.container.querySelector('button[aria-label="Gerenciar quartos de Pousada do Cariri"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flushAct(() => {
      document.body.querySelector('button[aria-label="Editar quarto 101"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flushAct(() => {
      Array.from(document.body.querySelectorAll("button"))
        .find(button => button.textContent === "Salvar")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.querySelector('input[placeholder="Ex.: 101 ou Suíte 1"]')).not.toBeNull();
    expect(document.body.textContent).toContain("101");
    expect(mockRoomQuery.refetch).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Não foi possível salvar o quarto. A alteração não foi aplicada. Tente novamente.",
      variant: "destructive",
    }));
    expect(mockToast.mock.calls.flat().join(" ")).not.toContain("database host unavailable");
  });

  it("activates an inactive room through the status action and refreshes the list", async () => {
    mockRoomQuery.data = [{
      id: "room-1",
      name: "101",
      category: "standard",
      capacity: 2,
      pricePerNight: null,
      occupied: 0,
      status: "inactive",
    }];
    mockMutation.mutateAsync.mockImplementation(async ({ data }: { data: { status?: string } }) => {
      mockRoomQuery.data = [{ ...mockRoomQuery.data[0], status: data.status }];
    });

    const handle = await renderComponent(createElement(Hospedagens));
    await flushAct(() => {
      handle.container.querySelector('button[aria-label="Gerenciar quartos de Pousada do Cariri"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flushAct(() => {
      document.body.querySelector('button[aria-label="Ativar quarto 101"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(mockMutation.mutateAsync).toHaveBeenCalledWith({
      id: "room-1",
      data: { status: "active" },
    });
    expect(mockRoomQuery.refetch).toHaveBeenCalledTimes(1);
    expect(mockAuditQuery.refetch).toHaveBeenCalledTimes(1);
    await handle.rerender(createElement(Hospedagens));
    expect(document.body.textContent).toContain("Ativo");
    expect(document.body.querySelector('button[aria-label="Inativar quarto 101"]')).not.toBeNull();
    expect(mockToast).toHaveBeenCalledWith({ title: "Quarto ativado" });
  });

  it("keeps an active room active and gives a safe error when deactivation fails", async () => {
    mockRoomQuery.data = [{
      id: "room-1",
      name: "101",
      category: "standard",
      capacity: 2,
      pricePerNight: null,
      occupied: 0,
      status: "active",
    }];
    mockMutation.mutateAsync.mockRejectedValue(new Error("database host unavailable"));

    const handle = await renderComponent(createElement(Hospedagens));
    await flushAct(() => {
      handle.container.querySelector('button[aria-label="Gerenciar quartos de Pousada do Cariri"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flushAct(() => {
      document.body.querySelector('button[aria-label="Inativar quarto 101"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(document.body.textContent).toContain("Ativo");
    expect(mockRoomQuery.refetch).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Não foi possível inativar o quarto. O status não foi alterado. Tente novamente.",
      variant: "destructive",
    }));
    expect(mockToast.mock.calls.flat().join(" ")).not.toContain("database host unavailable");
  });
});