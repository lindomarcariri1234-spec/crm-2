import crypto from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  db,
  distributionOffersTable,
  distributionOperationsTable,
  tenantIntegrationsTable,
} from "@workspace/db";
import { ConflictError, NotFoundError } from "../../lib/errors";
import {
  DistributionProviderError,
  type DistributionAdapter,
  type DistributionOperation,
} from "./contracts";
import { referenceDistributionAdapter } from "./reference-adapter";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const adapters: Record<string, DistributionAdapter> = {
  [referenceDistributionAdapter.type]: referenceDistributionAdapter,
};

const RETRYABLE_OPERATIONS = new Set<DistributionOperation>(["search", "availability"]);
const rateLimitWindows = new Map<string, { startedAt: number; count: number }>();

function hashRequest(request: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

function sanitizedError(error: unknown): { code: string; message: string; statusCode: number } {
  if (error instanceof DistributionProviderError) {
    return { code: error.code, message: error.message, statusCode: error.statusCode };
  }
  return { code: "PROVIDER_UNAVAILABLE", message: "O fornecedor não está disponível no momento.", statusCode: 502 };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new DistributionProviderError(
          "Tempo limite do fornecedor excedido.",
          "PROVIDER_TIMEOUT",
          { retryable: true, statusCode: 504 },
        )), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getConfiguredAdapter(tenantId: string): Promise<{ adapter: DistributionAdapter; rateLimit: number }> {
  const [integration] = await db.select({
    type: tenantIntegrationsTable.type,
    enabled: tenantIntegrationsTable.enabled,
    environment: tenantIntegrationsTable.environment,
    config: tenantIntegrationsTable.config,
  }).from(tenantIntegrationsTable).where(and(
    eq(tenantIntegrationsTable.tenantId, tenantId),
    eq(tenantIntegrationsTable.type, referenceDistributionAdapter.type),
  )).limit(1);

  if (!integration || !integration.enabled || integration.environment !== "test") {
    throw new ConflictError("Ative o fornecedor de referência no ambiente de teste antes de operar.", "DISTRIBUTION_NOT_ENABLED");
  }
  const configuredLimit = Number((integration.config as Record<string, unknown>)?.rateLimitPerMinute);
  return {
    adapter: adapters[integration.type]!,
    rateLimit: Number.isInteger(configuredLimit) && configuredLimit > 0 ? Math.min(configuredLimit, 120) : 30,
  };
}

function enforceRateLimit(tenantId: string, providerType: string, limit: number): void {
  const key = `${tenantId}:${providerType}`;
  const now = Date.now();
  const current = rateLimitWindows.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    rateLimitWindows.set(key, { startedAt: now, count: 1 });
    return;
  }
  if (current.count >= limit) {
    throw new DistributionProviderError("Limite de operações do fornecedor atingido. Tente novamente em instantes.", "PROVIDER_RATE_LIMITED", { statusCode: 429 });
  }
  current.count += 1;
}

export async function runDistributionOperation<T>(
  args: {
    tenantId: string;
    operation: DistributionOperation;
    idempotencyKey: string;
    request: unknown;
    offerId?: string;
    execute: (adapter: DistributionAdapter) => Promise<T>;
    finalize?: (tx: DbTransaction, response: T, operationId: string) => Promise<void>;
  },
): Promise<{ response: T; operationId: string; replayed: boolean }> {
  const configured = await getConfiguredAdapter(args.tenantId);
  const { adapter } = configured;
  const requestHash = hashRequest(args.request);
  const [known] = await db.select().from(distributionOperationsTable).where(and(
    eq(distributionOperationsTable.tenantId, args.tenantId),
    eq(distributionOperationsTable.integrationType, adapter.type),
    eq(distributionOperationsTable.idempotencyKey, args.idempotencyKey),
  )).limit(1);
  if (known?.requestHash === requestHash && known.operation === args.operation && known.status === "succeeded" && known.response) {
    return { response: known.response as T, operationId: known.id, replayed: true };
  }
  if (!known) enforceRateLimit(args.tenantId, adapter.type, configured.rateLimit);
  const operationId = crypto.randomUUID();
  const [claimed] = await db.insert(distributionOperationsTable).values({
    id: operationId,
    tenantId: args.tenantId,
    integrationType: adapter.type,
    operation: args.operation,
    idempotencyKey: args.idempotencyKey,
    requestHash,
    offerId: args.offerId,
    status: "started",
  }).onConflictDoNothing().returning({ id: distributionOperationsTable.id });

  if (!claimed) {
    const [existing] = await db.select().from(distributionOperationsTable).where(and(
      eq(distributionOperationsTable.tenantId, args.tenantId),
      eq(distributionOperationsTable.integrationType, adapter.type),
      eq(distributionOperationsTable.idempotencyKey, args.idempotencyKey),
    )).limit(1);
    if (!existing) {
      throw new ConflictError("Não foi possível confirmar a operação concorrente. Tente novamente.", "IDEMPOTENCY_CLAIM_CONFLICT");
    }
    if (existing.requestHash !== requestHash || existing.operation !== args.operation) {
      throw new ConflictError("A chave de idempotência já foi usada para outra operação.", "IDEMPOTENCY_KEY_REUSED");
    }
    if (existing.status === "succeeded" && existing.response) {
      return { response: existing.response as T, operationId: existing.id, replayed: true };
    }
    if (existing.status === "started") {
      throw new ConflictError("Esta operação já está em processamento.", "OPERATION_IN_PROGRESS");
    }
    if (existing.status === "failed") {
      throw new ConflictError(
        "Esta chave de idempotência já registrou uma falha. Gere uma nova chave para tentar novamente.",
        "OPERATION_PREVIOUSLY_FAILED",
      );
    }
  }

  const startedAt = Date.now();
  let lastError: unknown;
  const attempts = RETRYABLE_OPERATIONS.has(args.operation) ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await withTimeout(args.execute(adapter), 10_000);
      await db.transaction(async (tx) => {
        if (args.finalize) await args.finalize(tx, response, operationId);
        await tx.update(distributionOperationsTable).set({
          status: "succeeded",
          response: response as Record<string, unknown>,
          latencyMs: Date.now() - startedAt,
          updatedAt: new Date(),
        }).where(eq(distributionOperationsTable.id, operationId));
      });
      return { response, operationId, replayed: false };
    } catch (error) {
      lastError = error;
      const providerError = error instanceof DistributionProviderError ? error : null;
      if (!providerError?.retryable || attempt === attempts - 1) break;
    }
  }

  const failure = sanitizedError(lastError);
  await db.update(distributionOperationsTable).set({
    status: "failed",
    errorCode: failure.code,
    errorMessage: failure.message,
    latencyMs: Date.now() - startedAt,
    updatedAt: new Date(),
  }).where(eq(distributionOperationsTable.id, operationId));
  if (failure.statusCode === 404) throw new NotFoundError(failure.message, failure.code);
  throw new DistributionProviderError(failure.message, failure.code, { statusCode: failure.statusCode });
}

export async function persistDistributionOffers(
  tenantId: string,
  offers: Array<{
    externalId: string;
    kind: string;
    title: string;
    description?: string;
    origin?: string;
    destination?: string;
    price: number;
    currency: string;
    priceValidUntil: string;
    availableUnits?: number;
    cancellationPolicy?: string;
    metadata: Record<string, unknown>;
  }>,
): Promise<void> {
  for (const offer of offers) {
    const [existing] = await db.select({
      id: distributionOffersTable.id,
      availableUnits: distributionOffersTable.availableUnits,
    }).from(distributionOffersTable).where(and(
      eq(distributionOffersTable.tenantId, tenantId),
      eq(distributionOffersTable.integrationType, referenceDistributionAdapter.type),
      eq(distributionOffersTable.externalId, offer.externalId),
    )).limit(1);
    const values = {
      tenantId,
      integrationType: referenceDistributionAdapter.type,
      externalId: offer.externalId,
      kind: offer.kind,
      title: offer.title,
      description: offer.description,
      origin: offer.origin,
      destination: offer.destination,
      price: offer.price.toFixed(2),
      currency: offer.currency,
      priceValidUntil: new Date(offer.priceValidUntil),
      availableUnits: existing?.availableUnits ?? offer.availableUnits,
      cancellationPolicy: offer.cancellationPolicy,
      metadata: offer.metadata,
      isActive: true,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    };
    if (existing) await db.update(distributionOffersTable).set(values).where(eq(distributionOffersTable.id, existing.id));
    else await db.insert(distributionOffersTable).values({ id: crypto.randomUUID(), ...values });
  }
}

export async function getDistributionHealth(tenantId: string) {
  const [integration] = await db.select({
    type: tenantIntegrationsTable.type,
    enabled: tenantIntegrationsTable.enabled,
    environment: tenantIntegrationsTable.environment,
    status: tenantIntegrationsTable.status,
    lastError: tenantIntegrationsTable.lastError,
    lastSyncAt: tenantIntegrationsTable.lastSyncAt,
  }).from(tenantIntegrationsTable).where(and(
    eq(tenantIntegrationsTable.tenantId, tenantId),
    eq(tenantIntegrationsTable.type, referenceDistributionAdapter.type),
  )).limit(1);
  const operations = await db.select({
    status: distributionOperationsTable.status,
    latencyMs: distributionOperationsTable.latencyMs,
    errorCode: distributionOperationsTable.errorCode,
    createdAt: distributionOperationsTable.createdAt,
  }).from(distributionOperationsTable).where(eq(distributionOperationsTable.tenantId, tenantId));
  const successful = operations.filter((op) => op.status === "succeeded");
  const failed = operations.filter((op) => op.status === "failed");
  return {
    type: referenceDistributionAdapter.type,
    enabled: integration?.enabled ?? false,
    environment: integration?.environment ?? "test",
    status: integration?.status ?? "disconnected",
    lastError: integration?.lastError ?? null,
    lastSyncAt: integration?.lastSyncAt?.toISOString() ?? null,
    operations: operations.length,
    successful: successful.length,
    failed: failed.length,
    averageLatencyMs: successful.length
      ? Math.round(successful.reduce((sum, op) => sum + (op.latencyMs ?? 0), 0) / successful.length)
      : null,
    lastOperationAt: operations[0]?.createdAt?.toISOString() ?? null,
    lastErrorCode: failed[0]?.errorCode ?? null,
  };
}