import { db } from "@workspace/db";
import { clientsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { ConflictError } from "./errors";
import { logger } from "./logger";
import { generateReferralCodeSuffix } from "./id";

const MAX_CANDIDATE_ATTEMPTS = 5;
const MAX_SERIALIZATION_RETRIES = 5;

class CodeConflictError extends Error {
  constructor() {
    super("code_taken");
    this.name = "CodeConflictError";
  }
}

function isCandidateConflict(err: unknown): boolean {
  if (err instanceof CodeConflictError) return true;
  return hasPgCode(err, "23505");
}

function isSerializationFailure(err: unknown): boolean {
  return hasPgCode(err, "40001");
}

function hasPgCode(err: unknown, code: string): boolean {
  if (err === null || typeof err !== "object") return false;
  const obj = err as Record<string, unknown>;
  if (typeof obj.code === "string" && obj.code === code) return true;
  if (obj.cause !== undefined) return hasPgCode(obj.cause, code);
  return false;
}

/**
 * Generates and persists a unique referral code for the given client inside a
 * serializable transaction. Returns the existing code if one was already assigned
 * by a concurrent request. Retries up to MAX_CANDIDATE_ATTEMPTS on collision.
 */
export async function generateAndAssignReferralCode(
  clientId: string,
  tenantId: string,
  baseCode: string,
  namePart: string,
  year: number,
): Promise<string> {
  for (let candidateIndex = 0; candidateIndex < MAX_CANDIDATE_ATTEMPTS; candidateIndex++) {
    // Candidate 0 is the caller-supplied base code (already carries a random
    // suffix in production). On collision, derive a fresh high-entropy candidate
    // instead of a predictable `${namePart}${year}${index}` so codes stay
    // unguessable. Computed once per candidateIndex (reused across serialization
    // retries) so a 40001 retry does not waste candidates.
    const candidate =
      candidateIndex === 0 ? baseCode : `${namePart}${year}${generateReferralCodeSuffix()}`;

    for (let serRetry = 0; serRetry < MAX_SERIALIZATION_RETRIES; serRetry++) {
      try {
        const code = await db.transaction(async (tx) => {
          const [current] = await tx
            .select({ id: clientsTable.id, referralCode: clientsTable.referralCode })
            .from(clientsTable)
            .where(eq(clientsTable.id, clientId))
            .limit(1);

          if (current?.referralCode) {
            return current.referralCode;
          }

          const [taken] = await tx
            .select({ id: clientsTable.id })
            .from(clientsTable)
            .where(
              and(
                eq(clientsTable.tenantId, tenantId),
                eq(clientsTable.referralCode, candidate),
              ),
            )
            .limit(1);

          if (taken) {
            throw new CodeConflictError();
          }

          await tx
            .update(clientsTable)
            .set({ referralCode: candidate, referralCodeGeneratedAt: new Date() })
            .where(and(eq(clientsTable.id, clientId), isNull(clientsTable.referralCode)));

          return candidate;
        }, { isolationLevel: "serializable" });

        return code;
      } catch (err: unknown) {
        if (isSerializationFailure(err)) {
          continue;
        }
        if (isCandidateConflict(err)) {
          break;
        }
        throw err;
      }
    }
  }

  logger.error(
    { clientId, tenantId, maxCandidateAttempts: MAX_CANDIDATE_ATTEMPTS },
    "referral_code_generation_exhausted: all attempts failed",
  );
  throw new ConflictError(
    "Não foi possível gerar um código de indicação único após múltiplas tentativas.",
    "REFERRAL_CODE_EXHAUSTED",
  );
}
