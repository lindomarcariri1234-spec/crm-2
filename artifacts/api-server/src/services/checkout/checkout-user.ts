// CRM client (clientsTable) upsert that runs INSIDE the order transaction for
// atomicity. Clerk portal account creation lives in `portal-account.ts` because
// it must run OUTSIDE the transaction (external Clerk API call, fire-and-forget,
// post-commit) and is invoked from `post-booking.ts`.
import { normalizeCpfInput, reconcileClientIdentity } from "../client-identity";
import type { Tx } from "./tx";

export interface UpsertCheckoutClientArgs {
  tenantId: string;
  email: string;
  name: string;
  phone?: string;
  cpf?: string;
  birthDate: Date | null;
  createdById: string;
}

export interface UpsertCheckoutClientResult {
  clientId: string;
  isNew: boolean;
}

export async function upsertCheckoutClient(tx: Tx, args: UpsertCheckoutClientArgs): Promise<UpsertCheckoutClientResult> {
  const { tenantId, email, name, phone, cpf, birthDate, createdById } = args;
  const result = await reconcileClientIdentity(tx, {
    tenantId,
    cpf: normalizeCpfInput(cpf),
    name,
    email,
    phone,
    birthDate,
    createdById,
    createIfMissing: true,
  });

  if (!result.clientId) {
    throw new Error("A identidade do cliente não pôde ser resolvida.");
  }
  return { clientId: result.clientId, isNew: result.created };
}
