import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSafeFetch, mockUploadFiles } = vi.hoisted(() => ({
  mockSafeFetch: vi.fn(),
  mockUploadFiles: vi.fn(),
}));

vi.mock("../lib/ssrf.js", () => ({
  ssrfSafeFetchBounded: (...args: unknown[]) => mockSafeFetch(...args),
}));

vi.mock("../lib/uploadthing.js", () => ({
  utapi: { uploadFiles: (...args: unknown[]) => mockUploadFiles(...args) },
}));

import {
  extractEvolutionInboundMedia,
  isInlineWhatsAppMediaType,
  safeWhatsAppMediaFileName,
  storeEvolutionInboundMedia,
} from "../services/whatsapp-media.js";

describe("Evolution inbound media", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts audio from a view-once envelope and keeps its provider message key", () => {
    const media = extractEvolutionInboundMedia({
      message: {
        viewOnceMessageV2: {
          message: {
            audioMessage: {
              mimetype: "audio/ogg; codecs=opus",
              ptt: true,
            },
          },
        },
      },
      messageId: "evo-message-1",
      remoteJid: "5511999999999@s.whatsapp.net",
    });

    expect(media).toEqual({
      kind: "audio",
      mimeType: "audio/ogg",
      fileName: "evo-message-1.ogg",
      caption: null,
      messageId: "evo-message-1",
      remoteJid: "5511999999999@s.whatsapp.net",
    });
    expect(isInlineWhatsAppMediaType(media?.mimeType)).toBe(true);
  });

  it("unwraps documents with captions and strips path/control characters from names", () => {
    const media = extractEvolutionInboundMedia({
      message: {
        documentWithCaptionMessage: {
          message: {
            documentMessage: {
              mimetype: "application/pdf",
              fileName: "../../relatorio\nfinal.pdf",
              caption: "Segue o comprovante",
            },
          },
        },
      },
      messageId: "evo-document-1",
      remoteJid: "5511999999999@s.whatsapp.net",
    });

    expect(media).toMatchObject({
      kind: "document",
      mimeType: "application/pdf",
      fileName: "relatorio_final.pdf",
      caption: "Segue o comprovante",
    });
    expect(
      safeWhatsAppMediaFileName("../../unsafe.html", "document", "text/html", "message-2"),
    ).toBe("unsafe.html");
  });

  it("downloads by the trusted Evolution message key and uploads with a private ACL", async () => {
    const media = extractEvolutionInboundMedia({
      message: { audioMessage: { mimetype: "audio/ogg" } },
      messageId: "evo-message-2",
      remoteJid: "5511888888888@s.whatsapp.net",
    });
    if (!media) throw new Error("Expected audio descriptor");

    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: JSON.stringify({
        base64: Buffer.from("audio-bytes").toString("base64"),
        mimetype: "audio/ogg",
        fileName: "voice.ogg",
      }),
    });
    mockUploadFiles.mockResolvedValue({
      data: {
        key: "private-audio-key",
        ufsUrl: "https://utfs.io/f/private-audio-key",
      },
      error: null,
    });

    const result = await storeEvolutionInboundMedia({
      baseUrl: "https://evolution.example",
      instanceName: "agency / main",
      apiKey: "server-side-key",
      media,
    });

    expect(result).toEqual({
      ok: true,
      media: {
        mediaUrl: "https://utfs.io/f/private-audio-key",
        mimeType: "audio/ogg",
        fileName: "voice.ogg",
      },
    });
    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://evolution.example/chat/getBase64FromMediaMessage/agency%20%2F%20main",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ apikey: "server-side-key" }),
        body: JSON.stringify({
          message: {
            key: {
              id: "evo-message-2",
              remoteJid: "5511888888888@s.whatsapp.net",
              fromMe: false,
            },
          },
        }),
        maxBytes: expect.any(Number),
      }),
    );
    expect(mockUploadFiles).toHaveBeenCalledWith(
      expect.objectContaining({ name: "voice.ogg" }),
      { acl: "private", contentDisposition: "inline" },
    );
  });

  it("keeps active document types as downloads and rejects invalid provider payloads", async () => {
    const media = extractEvolutionInboundMedia({
      message: { documentMessage: { mimetype: "text/html", fileName: "page.html" } },
      messageId: "evo-message-3",
      remoteJid: "5511777777777@s.whatsapp.net",
    });
    if (!media) throw new Error("Expected document descriptor");
    expect(media.mimeType).toBe("application/octet-stream");

    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: JSON.stringify({ base64: "not valid media!" }),
    });
    const result = await storeEvolutionInboundMedia({
      baseUrl: "https://evolution.example",
      instanceName: "agency",
      apiKey: "server-side-key",
      media,
    });

    expect(result).toEqual({ ok: false, reason: "invalid_provider_response" });
    expect(mockUploadFiles).not.toHaveBeenCalled();
  });
});