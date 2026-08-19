import { createHmac } from "crypto";
import type { Request, Response } from "express";

function guideSecret(): string {
  const key = process.env["CREDENTIAL_ENCRYPTION_KEY"];
  if (!key) {
    if (process.env.NODE_ENV !== "development") {
      throw new Error("CREDENTIAL_ENCRYPTION_KEY must be set — guide tokens cannot be signed safely without it");
    }
    // Dev-only: generate a non-deterministic placeholder so tests/dev HMAC works
    return crypto.randomUUID() + "_guide_app_v1";
  }
  return key + "_guide_app_v1";
}

export interface GuidePayload {
  tokenId: string;
  tripId: string;
  tenantId: string;
  guideName: string;
}

export function createGuideJwt(payload: GuidePayload): string {
  const full = JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 });
  const encoded = Buffer.from(full).toString("base64url");
  const sig = createHmac("sha256", guideSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyGuideJwt(token: string): GuidePayload | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", guideSecret()).update(encoded).digest("base64url");
  if (expected !== sig) return null;
  try {
    const p = JSON.parse(Buffer.from(encoded, "base64url").toString()) as GuidePayload & { exp: number };
    if (p.exp < Date.now()) return null;
    return { tokenId: p.tokenId, tripId: p.tripId, tenantId: p.tenantId, guideName: p.guideName };
  } catch {
    return null;
  }
}

export async function requireGuideAuth(req: Request, res: Response): Promise<GuidePayload | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Guia não autenticado", code: "GUIDE_UNAUTHORIZED" });
    return null;
  }
  const guide = verifyGuideJwt(auth.slice(7));
  if (!guide) {
    res.status(401).json({ error: "Token inválido ou expirado", code: "GUIDE_TOKEN_INVALID" });
    return null;
  }
  return guide;
}
