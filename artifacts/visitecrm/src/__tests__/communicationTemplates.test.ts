import { describe, expect, it } from "vitest";
import {
  extractTemplateVariables,
  prepareManualOutboundContent,
  resolveClientTemplate,
} from "../lib/communicationTemplates";

describe("communication template helpers", () => {
  it("does not copy one channel's content into the other", () => {
    expect(prepareManualOutboundContent({
      emailContent: "  Só e-mail  ",
      whatsappContent: "",
      clientName: "Ana",
    })).toEqual({
      emailHtml: "Só e-mail",
      whatsappText: "",
    });

    expect(prepareManualOutboundContent({
      emailContent: "",
      whatsappContent: "  Só WhatsApp  ",
      clientName: "Ana",
    })).toEqual({
      emailHtml: "",
      whatsappText: "Só WhatsApp",
    });
  });

  it("resolves the supported client-name variable safely for email HTML", () => {
    expect(prepareManualOutboundContent({
      emailContent: "<p>Olá {nome}</p>",
      whatsappContent: "Olá {NOME}",
      clientName: "Ana & <Filha>",
    })).toEqual({
      emailHtml: "<p>Olá Ana &amp; &lt;Filha&gt;</p>",
      whatsappText: "Olá Ana & <Filha>",
    });
  });

  it("records only supported template variables and leaves unknown tokens intact", () => {
    expect(extractTemplateVariables("Olá {nome}, viagem {viagem} em {data}"))
      .toEqual(["nome"]);
    expect(resolveClientTemplate("Olá {viagem}", "Ana")).toBe("Olá {viagem}");
  });
});