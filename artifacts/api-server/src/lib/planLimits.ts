import { db, tenantsTable, plansTable, usersTable, clientsTable, tripsTable, subscriptionsTable, usageTrackingTable } from "@workspace/db";
import { eq, or, count, and, desc } from "drizzle-orm";
import type { Request, Response } from "express";
import { randomUUID } from "crypto";

export async function persistUsageSnapshot(tenantId: string): Promise<void> {
  try {
    const [[userRow], [clientRow], [tripRow]] = await Promise.all([
      db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.tenantId, tenantId)),
      db.select({ cnt: count() }).from(clientsTable).where(eq(clientsTable.tenantId, tenantId)),
      db.select({ cnt: count() }).from(tripsTable).where(eq(tripsTable.tenantId, tenantId)),
    ]);

    const [activeSub] = await db
      .select()
      .from(subscriptionsTable)
      .where(and(
        eq(subscriptionsTable.tenantId, tenantId),
        or(eq(subscriptionsTable.status, "active"), eq(subscriptionsTable.status, "trial")),
      ))
      .orderBy(desc(subscriptionsTable.createdAt))
      .limit(1);

    const now = new Date();
    const periodStart = activeSub?.currentPeriodStart ?? new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = activeSub?.currentPeriodEnd ?? new Date(now.getFullYear(), now.getMonth() + 1, 0);

    await db.insert(usageTrackingTable).values({
      id: randomUUID(),
      tenantId,
      subscriptionId: activeSub?.id ?? null,
      periodStart,
      periodEnd,
      usersCount: userRow?.cnt ?? 0,
      clientsCount: clientRow?.cnt ?? 0,
      tripsCount: tripRow?.cnt ?? 0,
    });
  } catch {
    // non-blocking — usage recording failures must not break the request
  }
}

type ResourceType = "users" | "clients" | "trips";

export async function checkPlanLimit(
  tenantId: string,
  resource: ResourceType,
  req: Request,
  res: Response
): Promise<boolean> {
  try {
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
    if (!tenant) { res.status(404).json({ error: "Tenant não encontrado" }); return false; }

    // Enforce subscription/trial state before checking plan limits
    if (tenant.status === "suspended") {
      res.status(403).json({ error: "TENANT_SUSPENDED", message: "Esta conta está suspensa." });
      return false;
    }
    if (tenant.status === "cancelled") {
      res.status(403).json({ error: "SUBSCRIPTION_CANCELLED", message: "A assinatura desta conta foi cancelada." });
      return false;
    }
    if (tenant.status === "pending_payment") {
      res.status(403).json({ error: "SUBSCRIPTION_PAYMENT_REQUIRED", message: "É necessário concluir o pagamento para continuar." });
      return false;
    }
    if (tenant.status === "trial" && tenant.trialEndsAt && tenant.trialEndsAt < new Date()) {
      res.status(403).json({ error: "TRIAL_EXPIRED", message: "O período de teste expirou. Assine um plano para continuar." });
      return false;
    }

    const planId = tenant.planId;
    const [plan] = await db
      .select()
      .from(plansTable)
      .where(or(eq(plansTable.slug, planId), eq(plansTable.id, planId)))
      .limit(1);

    let maxAllowed: number;
    let current: number;

    if (resource === "users") {
      maxAllowed = tenant.maxUsersOverride ?? plan?.maxUsers ?? 3;
      const [row] = await db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.tenantId, tenantId));
      current = row?.cnt ?? 0;
    } else if (resource === "clients") {
      maxAllowed = tenant.maxClientsOverride ?? plan?.maxClients ?? 500;
      const [row] = await db.select({ cnt: count() }).from(clientsTable).where(eq(clientsTable.tenantId, tenantId));
      current = row?.cnt ?? 0;
    } else {
      maxAllowed = tenant.maxTripsOverride ?? plan?.maxTrips ?? 20;
      const [row] = await db.select({ cnt: count() }).from(tripsTable).where(eq(tripsTable.tenantId, tenantId));
      current = row?.cnt ?? 0;
    }

    if (current >= maxAllowed) {
      const labels: Record<ResourceType, string> = {
        users: "usuários",
        clients: "clientes",
        trips: "viagens",
      };
      res.status(403).json({
        error: "limit_exceeded",
        message: `Limite do plano atingido: máximo de ${maxAllowed} ${labels[resource]}. Faça upgrade para continuar.`,
        resource,
        current,
        limit: maxAllowed,
        planId,
      });
      return false;
    }

    void persistUsageSnapshot(tenantId);
    return true;
  } catch (err) {
    req.log?.error({ err }, "Error checking plan limit");
    res.status(500).json({ error: "Erro ao verificar limite do plano. Tente novamente." });
    return false;
  }
}
