import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type { Reservation } from "@workspace/api-client-react";
import { RESERVATION_STATUS } from "@workspace/permissions";
import { cleanupRoots, flushAct, renderComponent } from "../__tests__/eventSourceHarness.js";
import {
  findReservationByQrCode,
  getQrScannerCameraSupport,
  VoucherQrScannerDialog,
} from "./VoucherQrScannerDialog";

const reservation = {
  id: "reservation-1",
  voucherCode: "VCHR-2026-0001",
  reservationNumber: "RES-0001",
  status: RESERVATION_STATUS.CONFIRMED,
  checkedInAt: null,
  client: { name: "Ana Silva", whatsapp: "(88) 99999-1111" },
  trip: { name: "Rota do Cariri", departureDate: "2026-10-10" },
  seats: ["A1"],
} as unknown as Reservation;

function getButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

async function enterCode(value: string): Promise<void> {
  const input = document.body.querySelector<HTMLInputElement>("#voucher-qr-manual-code");
  if (!input) throw new Error("Manual voucher input not found");

  await flushAct(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flushAct(() => getButton("Localizar voucher").click());
}

afterEach(async () => {
  await cleanupRoots();
});

describe("VoucherQrScannerDialog", () => {
  it("does not check in when the entered code does not match a reservation", async () => {
    const onCheckIn = vi.fn(async () => {});
    await renderComponent(
      createElement(VoucherQrScannerDialog, {
        open: true,
        onOpenChange: vi.fn(),
        reservations: [reservation],
        onCheckIn,
        isCheckingIn: false,
      }),
    );

    await enterCode("UNKNOWN-VOUCHER");

    expect(document.body.textContent).toContain(
      "Não encontramos uma reserva com esse código.",
    );
    expect(onCheckIn).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Confirmar passageiro");
  });

  it("offers manual entry when camera access is unavailable", async () => {
    const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    const originalDetector = Object.getOwnPropertyDescriptor(globalThis, "BarcodeDetector");
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    Object.defineProperty(globalThis, "BarcodeDetector", { configurable: true, value: undefined });

    try {
      await renderComponent(
        createElement(VoucherQrScannerDialog, {
          open: true,
          onOpenChange: vi.fn(),
          reservations: [reservation],
          onCheckIn: vi.fn(async () => {}),
          isCheckingIn: false,
        }),
      );

      await flushAct(() => getButton("Ativar câmera").click());

      expect(document.body.textContent).toContain(
        "não disponibiliza acesso à câmera",
      );
      expect(document.body.querySelector("#voucher-qr-manual-code")).not.toBeNull();
    } finally {
      if (originalMediaDevices) {
        Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
      } else {
        delete (navigator as Navigator & { mediaDevices?: MediaDevices }).mediaDevices;
      }
      if (originalDetector) {
        Object.defineProperty(globalThis, "BarcodeDetector", originalDetector);
      } else {
        delete (globalThis as typeof globalThis & { BarcodeDetector?: unknown }).BarcodeDetector;
      }
    }
  });

  it("requires passenger confirmation before invoking check-in", async () => {
    const onCheckIn = vi.fn(async () => {});
    await renderComponent(
      createElement(VoucherQrScannerDialog, {
        open: true,
        onOpenChange: vi.fn(),
        reservations: [reservation],
        onCheckIn,
        isCheckingIn: false,
      }),
    );

    await enterCode("vchr-2026-0001");
    await flushAct(() => getButton("Confirmar passageiro").click());

    expect(onCheckIn).not.toHaveBeenCalled();
    await flushAct(async () => {
      getButton("Registrar check-in").click();
      await Promise.resolve();
    });

    expect(onCheckIn).toHaveBeenCalledWith("reservation-1");
    expect(document.body.textContent).toContain("Check-in registrado agora");
  });
});

describe("voucher QR matching and camera support", () => {
  it("matches voucher, reservation, and ID codes case-insensitively", () => {
    expect(findReservationByQrCode(" vchr-2026-0001 ", [reservation])).toBe(reservation);
    expect(findReservationByQrCode("res-0001", [reservation])).toBe(reservation);
    expect(findReservationByQrCode("RESERVATION-1", [reservation])).toBe(reservation);
    expect(findReservationByQrCode("unknown", [reservation])).toBeNull();
  });

  it("classifies a missing camera separately from unsupported QR detection", () => {
    expect(getQrScannerCameraSupport(undefined, class {})).toBe("camera-unavailable");
    expect(getQrScannerCameraSupport({ getUserMedia: vi.fn() }, undefined)).toBe("qr-unsupported");
  });
});