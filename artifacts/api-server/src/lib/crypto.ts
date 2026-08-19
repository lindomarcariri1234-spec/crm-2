import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM. Ciphertexts are stored as
//   enc:v1:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>
// The prefix lets us tell encrypted-at-rest values apart from legacy
// plaintext rows (used by the one-shot startup backfill in index.ts).
const PREFIX = "enc:v1:";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env["CREDENTIAL_ENCRYPTION_KEY"];
  if (!hex) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is not set");
  }
  const buf = Buffer.from(hex.trim(), "hex");
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex chars); got ${buf.length} bytes`,
    );
  }
  cachedKey = buf;
  return buf;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptCredential(plain: string): string {
  if (plain === "") return plain;
  if (isEncrypted(plain)) return plain;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

export function decryptCredential(value: string): string {
  if (!isEncrypted(value)) return value;
  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Malformed encrypted credential");
  const iv = Buffer.from(parts[0]!, "base64url");
  const tag = Buffer.from(parts[1]!, "base64url");
  const enc = Buffer.from(parts[2]!, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Malformed encrypted credential");
  }
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

// Returns plaintext when value is encrypted, the original when it's a legacy
// plaintext row, or null when the value is empty/null. Webhook + checkout
// callers should use this rather than reading the column directly.
export function decryptOrPassthrough(value: string | null | undefined): string | null {
  if (!value) return null;
  return isEncrypted(value) ? decryptCredential(value) : value;
}
