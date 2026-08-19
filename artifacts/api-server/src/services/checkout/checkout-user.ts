// CRM client (clientsTable) upsert that runs INSIDE the order transaction for
// atomicity. Clerk portal account creation lives in `portal-account.ts` because
// it must run OUTSIDE the transaction (external Clerk API call, fire-and-forget,
// post-commit) and is invoked from `post-booking.ts`.
import { clientsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { generateId } from "../../lib/id";
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

  const [existingByEmail] = await tx
    .select({ id: clientsTable.id, email: clientsTable.email, cpf: clientsTable.cpf, birthDate: clientsTable.birthDate })
    .from(clientsTable)
    .where(and(eq(clientsTable.tenantId, tenantId), eq(clientsTable.email, email)))
    .limit(1);

  let existing = existingByEmail ?? null;

  // Fallback: if no match by email and a CPF was supplied, try to locate an
  // existing client by CPF. This prevents duplicate records when a staff-
  // registered client has a different (or missing) email.
  if (!existing && cpf) {
    const [existingByCpf] = await tx
      .select({ id: clientsTable.id, email: clientsTable.email, cpf: clientsTable.cpf, birthDate: clientsTable.birthDate })
      .from(clientsTable)
      .where(and(eq(clientsTable.tenantId, tenantId), eq(clientsTable.cpf, cpf)))
      .limit(1);
    if (existingByCpf) {
      existing = existingByCpf;
    }
  }

  if (existing) {
    // Enrich NULL-only fields: if the existing CRM record has no birthDate,
    // CPF, or email, fill them in from the order. We never overwrite a value
    // that is already set — that stays staff-gated. Filling a NULL is safe
    // because there was no prior verified value to protect.
    const updates: Record<string, unknown> = {};

    if (!existing.birthDate && birthDate) {
      updates.birthDate = birthDate;
    }

    // Email enrichment: if the existing record has no email (empty string
    // or null), fill it from the checkout-provided email.
    if ((!existing.email || existing.email === "") && email) {
      updates.email = email;
    }

    if (!existing.cpf && cpf) {
      // Guard: only assign the CPF if no other client in the tenant already
      // owns it (same uniqueness check as for new clients).
      const [cpfOwner] = await tx
        .select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(eq(clientsTable.tenantId, tenantId), eq(clientsTable.cpf, cpf)))
        .limit(1);
      if (!cpfOwner) {
        updates.cpf = cpf;
      }
    }

    if (Object.keys(updates).length > 0) {
      await tx
        .update(clientsTable)
        .set(updates)
        .where(eq(clientsTable.id, existing.id));
    }

    return { clientId: existing.id, isNew: false };
  }

  const newClientId = generateId();
  let cpfToInsert: string | undefined;
  if (cpf) {
    const [cpfOwner] = await tx
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(and(eq(clientsTable.tenantId, tenantId), eq(clientsTable.cpf, cpf)))
      .limit(1);
    if (!cpfOwner) cpfToInsert = cpf;
  }
  await tx.insert(clientsTable).values({
    id: newClientId,
    tenantId,
    name,
    email,
    whatsapp: phone ?? "",
    createdById,
    ...(cpfToInsert ? { cpf: cpfToInsert } : {}),
    ...(birthDate ? { birthDate } : {}),
  });
  return { clientId: newClientId, isNew: true };
}
