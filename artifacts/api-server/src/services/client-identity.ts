import { clientsTable, usersTable } from "@workspace/db";
import { validateCpfOrThrow } from "@workspace/shared";
import { normalizeBrazilPhone } from "@workspace/shared";
import { and, eq, sql } from "drizzle-orm";
import { ConflictError, ValidationError } from "../lib/errors";
import { generateId } from "../lib/id";
import { normalizedClientWhatsappSql } from "../lib/client-phone";

type IdentityExecutor = Pick<typeof import("@workspace/db").db, "select" | "update" | "insert" | "execute">;

export interface ClientIdentityInput {
  tenantId: string;
  userId?: string;
  cpf?: string | null;
  name?: string;
  email?: string;
  phone?: string | null;
  birthDate?: Date | null;
  /**
   * Additional CRM fields collected by a registration flow. These are only
   * used to fill missing values; an existing non-empty value is authoritative.
   */
  profile?: ClientIdentityProfile;
  createdById?: string;
  createIfMissing?: boolean;
}

type ClientRow = typeof clientsTable.$inferSelect;
export type ClientIdentityProfile = Partial<Pick<ClientRow,
  | "name"
  | "email"
  | "whatsapp"
  | "phone"
  | "rg"
  | "birthDate"
  | "gender"
  | "photoUrl"
  | "instagram"
  | "origin"
  | "addressCity"
  | "addressState"
  | "observations"
  | "dreamDestinations"
  | "professionalArea"
  | "favoriteDrink"
  | "companyFeedback"
  | "musicalPreferences"
  | "foodPreferences"
  | "internalRating"
  | "companyNps"
  | "travelInterests"
  | "ambassadorOptIn"
>>;

export interface ClientIdentityResult {
  clientId: string | null;
  cpf: string | null;
  linked: boolean;
  created: boolean;
}

function normalizeCpfInput(cpf: string | null | undefined): string | null {
  if (cpf == null || cpf.trim() === "") return null;
  try {
    return validateCpfOrThrow(cpf);
  } catch {
    throw new ValidationError("CPF inválido.", "INVALID_CPF");
  }
}

async function lockCpf(tx: IdentityExecutor, tenantId: string, cpf: string): Promise<void> {
  // The tenant is part of the lock key so the same CPF may safely exist in
  // different agencies without serializing unrelated tenants.
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${tenantId} || ':' || ${cpf}, 0)
    )
  `);
}

async function findByCpf(tx: IdentityExecutor, tenantId: string, cpf: string) {
  const matches = await tx
    .select()
    .from(clientsTable)
    .where(and(eq(clientsTable.tenantId, tenantId), eq(clientsTable.cpf, cpf)))
    .limit(2);

  if (matches.length > 1) {
    throw new ConflictError(
      "Existem múltiplos cadastros com este CPF nesta agência. A vinculação automática foi bloqueada.",
      "CLIENT_CPF_AMBIGUOUS",
    );
  }
  return matches[0] ?? null;
}

async function findByUser(tx: IdentityExecutor, tenantId: string, userId: string) {
  const [client] = await tx
    .select()
    .from(clientsTable)
    .where(and(eq(clientsTable.tenantId, tenantId), eq(clientsTable.userId, userId)))
    .limit(1);
  return client ?? null;
}

function isMissing(value: unknown): boolean {
  return value == null
    || (typeof value === "string" && value.trim() === "")
    || (Array.isArray(value) && value.length === 0);
}

/**
 * Resolves the CRM identity around CPF. CPF is only considered inside the
 * supplied tenant; it never becomes a cross-agency lookup key.
 *
 * Existing non-empty CRM values are deliberately preserved. This function
 * links an unlinked CPF owner, enriches missing contact fields, and refuses
 * to guess when a user is already linked to another client record.
 */
export async function reconcileClientIdentity(
  tx: IdentityExecutor,
  input: ClientIdentityInput,
): Promise<ClientIdentityResult> {
  const cpf = normalizeCpfInput(input.cpf);
  const incomingProfile: ClientIdentityProfile = {
    ...input.profile,
    name: input.profile?.name ?? input.name,
    email: input.profile?.email ?? input.email,
    whatsapp: input.profile?.whatsapp ?? input.phone ?? undefined,
    phone: input.profile?.phone ?? input.phone,
    birthDate: input.profile?.birthDate ?? input.birthDate,
  };

  if (cpf) await lockCpf(tx, input.tenantId, cpf);

  let cpfOwner = cpf ? await findByCpf(tx, input.tenantId, cpf) : null;
  const currentClient = input.userId
    ? await findByUser(tx, input.tenantId, input.userId)
    : null;
  let created = false;

  if (cpfOwner && currentClient && cpfOwner.id !== currentClient.id) {
    throw new ConflictError(
      "Este usuário já está vinculado a outro cadastro de cliente. A unificação automática não foi realizada.",
      "CLIENT_IDENTITY_CONFLICT",
    );
  }

  let client = cpfOwner ?? currentClient;

  if (!client && input.email) {
    const emailMatches = await tx
      .select()
      .from(clientsTable)
      .where(and(
        eq(clientsTable.tenantId, input.tenantId),
        sql`lower(btrim(${clientsTable.email})) = lower(btrim(${input.email}))`,
      ))
      .limit(2);

    // Email is only a fallback. It must be unique and unclaimed, otherwise
    // CPF/email cannot safely identify the same person.
    if (emailMatches.length === 1 && !emailMatches[0].userId) {
      client = emailMatches[0];
    } else if (emailMatches.length > 1) {
      throw new ConflictError(
        "O e-mail corresponde a mais de um cadastro de cliente nesta agência.",
        "CLIENT_EMAIL_AMBIGUOUS",
      );
    } else if (emailMatches.length === 1 && emailMatches[0].userId && input.userId !== emailMatches[0].userId) {
      throw new ConflictError(
        "O e-mail já está vinculado a outra conta de cliente nesta agência.",
        "CLIENT_EMAIL_ALREADY_LINKED",
      );
    }
  }

  if (!client && input.phone) {
    const normalizedPhone = normalizeBrazilPhone(input.phone);
    if (normalizedPhone) {
      const phoneMatches = await tx
        .select()
        .from(clientsTable)
        .where(and(
          eq(clientsTable.tenantId, input.tenantId),
          sql`${normalizedClientWhatsappSql()} = ${normalizedPhone}`,
        ))
        .limit(2);

      if (phoneMatches.length > 1) {
        throw new ConflictError(
          "O telefone corresponde a mais de um cadastro de cliente nesta agência.",
          "CLIENT_PHONE_AMBIGUOUS",
        );
      }
      if (phoneMatches.length === 1 && !phoneMatches[0].userId) {
        client = phoneMatches[0];
      } else if (phoneMatches.length === 1 && phoneMatches[0].userId && input.userId !== phoneMatches[0].userId) {
        throw new ConflictError(
          "O telefone já está vinculado a outra conta de cliente nesta agência.",
          "CLIENT_PHONE_ALREADY_LINKED",
        );
      }
    }
  }

  if (!client && input.createIfMissing) {
    if (!input.name || !input.createdById) {
      throw new ValidationError("Dados insuficientes para criar o cadastro de cliente.", "CLIENT_CREATE_DATA_REQUIRED");
    }

    const clientValues = {
      id: generateId(),
      tenantId: input.tenantId,
      name: incomingProfile.name ?? "",
      email: incomingProfile.email ?? "",
      whatsapp: incomingProfile.whatsapp ?? "",
      createdById: input.createdById,
      ...(input.userId ? { userId: input.userId } : {}),
      ...(cpf ? { cpf } : {}),
      ...Object.fromEntries(
        Object.entries(incomingProfile).filter(([key, value]) =>
          !["name", "email", "whatsapp", "cpf", "userId", "createdById"].includes(key)
          && value !== undefined,
        ),
      ),
    };
    const [createdClient] = await tx
      .insert(clientsTable)
      .values(clientValues)
      .returning();

    if (!createdClient) throw new ConflictError("Não foi possível criar o cadastro do cliente.", "CLIENT_CREATE_FAILED");
    client = createdClient;
    cpfOwner = createdClient;
    created = true;
  }

  if (!client) {
    if (input.userId && cpf) {
      await tx
        .update(usersTable)
        .set({ cpf })
        .where(and(eq(usersTable.id, input.userId), eq(usersTable.tenantId, input.tenantId)));
    }
    return { clientId: null, cpf, linked: false, created: false };
  }

  if (client.userId && input.userId && client.userId !== input.userId) {
    throw new ConflictError(
      "Este CPF já está vinculado a outra conta de acesso nesta agência.",
      "CLIENT_CPF_ALREADY_LINKED",
    );
  }

  const updates: Record<string, unknown> = {};
  if (!client.userId && input.userId) updates.userId = input.userId;
  if (cpf && client.cpf && client.cpf !== cpf) {
    throw new ConflictError(
      "Este cadastro já possui outro CPF nesta agência. A unificação automática foi bloqueada.",
      "CLIENT_CPF_CONFLICT",
    );
  }
  for (const [key, value] of Object.entries(incomingProfile)) {
    if (value !== undefined && isMissing(client[key as keyof ClientRow])) {
      updates[key] = value;
    }
  }
  if (cpf && !client.cpf) updates.cpf = cpf;
  if (Object.keys(updates).length > 0) {
    updates.updatedAt = new Date();
    await tx
      .update(clientsTable)
      .set(updates)
      .where(and(eq(clientsTable.id, client.id), eq(clientsTable.tenantId, input.tenantId)));
    client = { ...client, ...updates } as ClientRow;
  }

  if (input.userId) {
    const userUpdates: Record<string, unknown> = {};
    if (cpf && !cpfOwner?.userId) userUpdates.cpf = cpf;
    if (Object.keys(userUpdates).length > 0) {
      await tx
        .update(usersTable)
        .set(userUpdates)
        .where(and(eq(usersTable.id, input.userId), eq(usersTable.tenantId, input.tenantId)));
    }
  }

  return {
    clientId: client.id,
    cpf: client.cpf ?? cpf,
    linked: Boolean(input.userId && client.userId === input.userId),
    created,
  };
}

export { normalizeCpfInput };