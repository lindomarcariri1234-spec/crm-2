import { Router, type NextFunction } from "express";
import { db, npsInvitationsTable, clientNpsResponsesTable, clientsTable, tenantsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateId } from "../lib/id";
import { logger } from "../lib/logger";

const router = Router();

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function classifyScore(score: number): "promoter" | "passive" | "detractor" {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

function thankYouHtml(agencyName: string, score: number): string {
  const cls = classifyScore(score);
  const message =
    cls === "promoter"
      ? "Que alegria! Obrigado por ser nosso promotor. 🎉"
      : cls === "passive"
      ? "Obrigado pela sua avaliação! Vamos continuar melhorando."
      : "Obrigado pela sua honestidade. Seu feedback é muito importante para nós.";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Obrigado pela sua avaliação!</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); padding: 48px 40px; max-width: 480px; width: 100%; text-align: center; }
    .score { width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 800; color: #fff; margin: 0 auto 24px; background: ${cls === "promoter" ? "#16a34a" : cls === "passive" ? "#ca8a04" : "#dc2626"}; }
    h1 { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
    p { color: #64748b; font-size: 16px; line-height: 1.6; }
    .agency { color: #94a3b8; font-size: 13px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="score">${score}</div>
    <h1>Obrigado pela sua avaliação!</h1>
    <p>${message}</p>
    <p class="agency">${escapeHtml(agencyName)}</p>
  </div>
</body>
</html>`;
}

router.get("/nps/respond", async (req, res, next: NextFunction): Promise<void> => {
  const { token, score: scoreStr, comment } = req.query as Record<string, string>;

  const score = parseInt(scoreStr ?? "", 10);
  if (!token || isNaN(score) || score < 0 || score > 10) {
    res.status(400).send("<h1>Link inválido</h1><p>Parâmetros incorretos.</p>");
    return;
  }

  try {
    const [invitation] = await db
      .select({
        id: npsInvitationsTable.id,
        tenantId: npsInvitationsTable.tenantId,
        clientId: npsInvitationsTable.clientId,
        reservationId: npsInvitationsTable.reservationId,
        tripId: npsInvitationsTable.tripId,
        respondedAt: npsInvitationsTable.respondedAt,
      })
      .from(npsInvitationsTable)
      .where(eq(npsInvitationsTable.token, token))
      .limit(1);

    if (!invitation) {
      res.status(404).send("<h1>Link não encontrado</h1><p>Este link de pesquisa não existe ou expirou.</p>");
      return;
    }

    const [tenant] = await db
      .select({ name: tenantsTable.name })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, invitation.tenantId))
      .limit(1);

    const agencyName = tenant?.name ?? "a agência";

    if (invitation.respondedAt) {
      res.status(200).send(thankYouHtml(agencyName, score));
      return;
    }

    const existingResponse = await db
      .select({ id: clientNpsResponsesTable.id })
      .from(clientNpsResponsesTable)
      .where(eq(clientNpsResponsesTable.reservationId, invitation.reservationId))
      .limit(1);

    if (existingResponse.length === 0) {
      await db.insert(clientNpsResponsesTable).values({
        id: generateId(),
        tenantId: invitation.tenantId,
        clientId: invitation.clientId,
        reservationId: invitation.reservationId,
        tripId: invitation.tripId ?? null,
        score,
        comment: comment ?? null,
      });

      await db
        .update(clientsTable)
        .set({ npsScore: score })
        .where(
          and(
            eq(clientsTable.id, invitation.clientId),
            eq(clientsTable.tenantId, invitation.tenantId),
          ),
        );
    }

    await db
      .update(npsInvitationsTable)
      .set({ respondedAt: new Date() })
      .where(eq(npsInvitationsTable.id, invitation.id));

    logger.info(
      { token, score, tenantId: invitation.tenantId, clientId: invitation.clientId },
      "[nps] Response recorded via email link",
    );

    res.status(200).send(thankYouHtml(agencyName, score));
  } catch (err) {
    next(err);
  }
});

export default router;
