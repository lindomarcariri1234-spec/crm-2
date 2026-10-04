import { ssrfSafeFetchBounded } from "../lib/ssrf.js";
import { utapi } from "../lib/uploadthing.js";

export type EvolutionMediaKind = "audio" | "image" | "video" | "document";

export interface EvolutionInboundMedia {
  kind: EvolutionMediaKind;
  mimeType: string;
  fileName: string;
  caption: string | null;
  messageId: string;
  remoteJid: string;
}

export interface StoredEvolutionMedia {
  mediaUrl: string;
  mimeType: string;
  fileName: string;
}

export type StoreEvolutionMediaResult =
  | { ok: true; media: StoredEvolutionMedia }
  | { ok: false; reason: "missing_message_key" | "provider_http_error" | "invalid_provider_response" | "file_too_large" | "storage_upload_failed" | "request_failed" };

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 15 * 1024 * 1024;

const MEDIA_MESSAGE_KEYS: ReadonlyArray<readonly [string, EvolutionMediaKind]> = [
  ["audioMessage", "audio"],
  ["imageMessage", "image"],
  ["videoMessage", "video"],
  ["documentMessage", "document"],
  ["stickerMessage", "image"],
];

const INLINE_MEDIA_TYPES = new Set([
  "audio/aac",
  "audio/amr",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/webm",
  "audio/x-wav",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/3gpp",
  "video/mp4",
  "video/webm",
]);

const ACTIVE_CONTENT_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-javascript",
  "image/svg+xml",
  "text/html",
  "text/javascript",
  "application/xhtml+xml",
]);

const DEFAULT_MIME_TYPES: Record<EvolutionMediaKind, string> = {
  audio: "audio/ogg",
  image: "image/jpeg",
  video: "video/mp4",
  document: "application/octet-stream",
};

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/3gpp": "3gp",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function unwrapEvolutionMessage(value: Record<string, unknown>): Record<string, unknown> {
  let message = value;
  for (let depth = 0; depth < 6; depth += 1) {
    const wrapped = [
      "ephemeralMessage",
      "viewOnceMessage",
      "viewOnceMessageV2",
      "viewOnceMessageV2Extension",
      "documentWithCaptionMessage",
    ]
      .map((key) => message[key])
      .find(isRecord);
    const inner = wrapped && isRecord(wrapped["message"]) ? wrapped["message"] : null;
    if (!inner) break;
    message = inner;
  }
  return message;
}

export function normalizeWhatsAppMediaMimeType(
  rawMimeType: string | null | undefined,
  kind: EvolutionMediaKind,
): string {
  const candidate = rawMimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(candidate)) {
    return DEFAULT_MIME_TYPES[kind];
  }
  return ACTIVE_CONTENT_TYPES.has(candidate) ? "application/octet-stream" : candidate;
}

export function safeWhatsAppMediaFileName(
  rawFileName: string | null | undefined,
  kind: EvolutionMediaKind,
  mimeType: string,
  messageId: string,
): string {
  const basename = rawFileName?.replace(/\\/g, "/").split("/").at(-1) ?? "";
  const cleaned = basename
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120);
  if (cleaned) return cleaned;

  const extension = MIME_EXTENSIONS[mimeType] ?? (kind === "document" ? "bin" : kind);
  const safeId = messageId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "received";
  return `${safeId}.${extension}`;
}

export function extractEvolutionInboundMedia(input: {
  message: Record<string, unknown>;
  messageId: string | null;
  remoteJid: string;
}): EvolutionInboundMedia | null {
  const message = unwrapEvolutionMessage(input.message);
  for (const [messageKey, kind] of MEDIA_MESSAGE_KEYS) {
    const media = message[messageKey];
    if (!isRecord(media)) continue;
    const rawMimeType = typeof media["mimetype"] === "string"
      ? media["mimetype"]
      : typeof media["mimeType"] === "string" ? media["mimeType"] : null;
    const mimeType = normalizeWhatsAppMediaMimeType(rawMimeType, kind);
    const rawFileName = typeof media["fileName"] === "string"
      ? media["fileName"]
      : typeof media["filename"] === "string" ? media["filename"] : null;
    const messageId = input.messageId ?? "";
    return {
      kind,
      mimeType,
      fileName: safeWhatsAppMediaFileName(rawFileName, kind, mimeType, messageId),
      caption: typeof media["caption"] === "string" ? media["caption"].trim().slice(0, 4_000) || null : null,
      messageId,
      remoteJid: input.remoteJid,
    };
  }
  return null;
}

function providerMediaFields(value: unknown): {
  base64: string;
  mimeType: string | null;
  fileName: string | null;
} | null {
  if (!isRecord(value)) return null;
  const containers = [value, value["data"], value["response"]].filter(isRecord);
  for (const container of containers) {
    const rawBase64 = typeof container["base64"] === "string"
      ? container["base64"]
      : typeof container["base64Data"] === "string"
        ? container["base64Data"]
        : typeof container["data"] === "string"
          ? container["data"]
          : typeof container["media"] === "string" ? container["media"] : null;
    if (!rawBase64) continue;

    const mimeType = typeof container["mimetype"] === "string"
      ? container["mimetype"]
      : typeof container["mimeType"] === "string"
        ? container["mimeType"]
        : typeof container["mediaType"] === "string" && container["mediaType"].includes("/")
          ? container["mediaType"]
          : null;
    const fileName = typeof container["fileName"] === "string"
      ? container["fileName"]
      : typeof container["filename"] === "string" ? container["filename"] : null;
    return { base64: rawBase64, mimeType, fileName };
  }
  return null;
}

function decodeProviderBase64(value: string): Buffer | null {
  const dataUri = /^data:([^;,]+);base64,/i.exec(value);
  const raw = dataUri ? value.slice(dataUri[0].length) : value;
  const normalized = raw.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (
    normalized.length === 0
    || normalized.length > Math.ceil(MAX_MEDIA_BYTES * 4 / 3) + 4
    || normalized.length % 4 === 1
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    return null;
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length === 0 || bytes.length > MAX_MEDIA_BYTES) return null;
  return bytes;
}

function extractDataUriMimeType(value: string): string | null {
  return /^data:([^;,]+);base64,/i.exec(value)?.[1] ?? null;
}

export async function storeEvolutionInboundMedia(input: {
  baseUrl: string;
  instanceName: string;
  apiKey: string;
  media: EvolutionInboundMedia;
}): Promise<StoreEvolutionMediaResult> {
  if (!input.media.messageId || !input.media.remoteJid) {
    return { ok: false, reason: "missing_message_key" };
  }

  try {
    const encodedInstance = encodeURIComponent(input.instanceName);
    const url = `${input.baseUrl.replace(/\/$/, "")}/chat/getBase64FromMediaMessage/${encodedInstance}`;
    const response = await ssrfSafeFetchBounded(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: input.apiKey },
      body: JSON.stringify({
        message: {
          key: {
            id: input.media.messageId,
            remoteJid: input.media.remoteJid,
            fromMe: false,
          },
        },
      }),
      timeoutMs: 15_000,
      maxBytes: MAX_PROVIDER_RESPONSE_BYTES,
    });
    if (!response.ok) return { ok: false, reason: "provider_http_error" };

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text) as unknown;
    } catch {
      return { ok: false, reason: "invalid_provider_response" };
    }
    const fields = providerMediaFields(parsed);
    if (!fields) return { ok: false, reason: "invalid_provider_response" };
    const bytes = decodeProviderBase64(fields.base64);
    if (!bytes) {
      return {
        ok: false,
        reason: fields.base64.length > Math.ceil(MAX_MEDIA_BYTES * 4 / 3) + 4
          ? "file_too_large"
          : "invalid_provider_response",
      };
    }

    const mimeType = normalizeWhatsAppMediaMimeType(
      fields.mimeType ?? extractDataUriMimeType(fields.base64) ?? input.media.mimeType,
      input.media.kind,
    );
    const fileName = safeWhatsAppMediaFileName(
      fields.fileName ?? input.media.fileName,
      input.media.kind,
      mimeType,
      input.media.messageId,
    );
    const inline = INLINE_MEDIA_TYPES.has(mimeType);
    const file = Object.assign(
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
      { name: fileName },
    );
    const upload = await utapi.uploadFiles(file, {
      acl: "private",
      contentDisposition: inline ? "inline" : "attachment",
    });
    if (upload.error !== null || !upload.data.ufsUrl) {
      return { ok: false, reason: "storage_upload_failed" };
    }

    return {
      ok: true,
      media: {
        mediaUrl: upload.data.ufsUrl,
        mimeType,
        fileName,
      },
    };
  } catch {
    return { ok: false, reason: "request_failed" };
  }
}

export function isInlineWhatsAppMediaType(mimeType: string | null | undefined): boolean {
  return Boolean(mimeType && INLINE_MEDIA_TYPES.has(mimeType.toLowerCase()));
}