import { describe, expect, it } from "vitest";
import {
  countWhatsAppDefaults,
  getWhatsAppDefaultActionLabel,
  type WhatsAppDefaultCandidate,
} from "../lib/whatsapp-defaults";

describe("WhatsApp connection default settings", () => {
  it("surfaces duplicate defaults and offers correction only on a connected, enabled connection", () => {
    const disconnectedDefault: WhatsAppDefaultCandidate = {
      isDefault: true,
      enabled: false,
      status: "disconnected",
    };
    const connectedDefault: WhatsAppDefaultCandidate = {
      isDefault: true,
      enabled: true,
      status: "connected",
    };

    expect(countWhatsAppDefaults([disconnectedDefault, connectedDefault])).toBe(2);
    expect(getWhatsAppDefaultActionLabel(disconnectedDefault, 2)).toBeNull();
    expect(getWhatsAppDefaultActionLabel(connectedDefault, 2)).toBe("Corrigir número padrão");
    expect(getWhatsAppDefaultActionLabel(connectedDefault, 1)).toBeNull();
  });

  it("only offers default selection after reconnecting successfully", () => {
    expect(getWhatsAppDefaultActionLabel({
      isDefault: false,
      enabled: false,
      status: "connected",
    }, 0)).toBeNull();
    expect(getWhatsAppDefaultActionLabel({
      isDefault: false,
      enabled: true,
      status: "disconnected",
    }, 0)).toBeNull();
    expect(getWhatsAppDefaultActionLabel({
      isDefault: false,
      enabled: true,
      status: "connected",
    }, 0)).toBe("Tornar padrão");
  });

  it("reflects the winner after settings reload the connections list", () => {
    const refreshedConnections: WhatsAppDefaultCandidate[] = [
      { isDefault: false, enabled: true, status: "connected" },
      { isDefault: true, enabled: true, status: "connected" },
    ];

    expect(countWhatsAppDefaults(refreshedConnections)).toBe(1);
    expect(getWhatsAppDefaultActionLabel(refreshedConnections[0]!, 1)).toBe("Tornar padrão");
    expect(getWhatsAppDefaultActionLabel(refreshedConnections[1]!, 1)).toBeNull();
  });
});
