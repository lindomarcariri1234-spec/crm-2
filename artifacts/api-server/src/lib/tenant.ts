import { db } from "@workspace/db";
import { usersTable, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import { ROLES, ADMIN_ROLES, MANAGEMENT_ROLES, ALL_STAFF_ROLES } from "@workspace/permissions";

export type { Role } from "@workspace/permissions";
export { ROLES, ADMIN_ROLES, MANAGEMENT_ROLES, ALL_STAFF_ROLES };

import type { Role } from "@workspace/permissions";
export const AGENCY_STAFF_ROLES = [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SALES, ROLES.SUPPORT] as const satisfies readonly Role[];

export type AuthedUser = {
  id: string;
  clerkId: string;
  tenantId: string;
  name: string;
  email: string;
  role: Role;
};

/**
 * Checks whether a tenant's subscription state allows access to protected routes.
 * Returns true if access is allowed, false (and sends a 403) if blocked.
 *
 * Blocked states:
 *   - "suspended"       — administratively suspended
 *   - "cancelled"       — subscription cancelled
 *   - "pending_payment" — billing required; user must complete payment to regain access
 *   - "trial" with trialEndsAt in the past — expired trial
 *
 * Allowed states:
 *   - "active"       — paying subscriber
 *   - "trial" (valid) — within the trial window
 *
 * Callers that must remain accessible regardless of billing state (e.g. subscription
 * management and invoice-payment routes) should pass `skipTenantStatusCheck: true`
 * to `requireAuth()` so that users in a `pending_payment` state can still reach the
 * payment completion flow.
 */
export async function checkTenantAccess(tenantId: string, req: Request, res: Response): Promise<boolean> {
  const [tenant] = await db
    .select({ status: tenantsTable.status, trialEndsAt: tenantsTable.trialEndsAt })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (!tenant) {
    res.status(403).json({
      error: "Tenant not found",
      code: "TENANT_NOT_FOUND",
      message: "Agência não encontrada.",
      requestId: req.id ?? "unknown",
    });
    return false;
  }

  const { status, trialEndsAt } = tenant;

  if (status === "suspended") {
    res.status(403).json({
      error: "Tenant suspended",
      code: "TENANT_SUSPENDED",
      message: "Esta conta está suspensa. Entre em contato com o suporte.",
      requestId: req.id ?? "unknown",
    });
    return false;
  }

  if (status === "cancelled") {
    res.status(403).json({
      error: "Subscription cancelled",
      code: "SUBSCRIPTION_CANCELLED",
      message: "A assinatura desta conta foi cancelada. Entre em contato com o suporte para reativação.",
      requestId: req.id ?? "unknown",
    });
    return false;
  }

  if (status === "pending_payment") {
    res.status(403).json({
      error: "Payment required",
      code: "SUBSCRIPTION_PAYMENT_REQUIRED",
      message: "É necessário concluir o pagamento para continuar usando o VisiteCRM. Acesse a área de assinatura para regularizar.",
      requestId: req.id ?? "unknown",
    });
    return false;
  }

  if (status === "trial") {
    const now = new Date();
    if (trialEndsAt && trialEndsAt < now) {
      res.status(403).json({
        error: "Trial expired",
        code: "TRIAL_EXPIRED",
        message: "O período de teste expirou. Assine um plano para continuar usando o VisiteCRM.",
        requestId: req.id ?? "unknown",
      });
      return false;
    }
  }

  return true;
}

export type RequireAuthOptions = {
  /**
   * When true, skip the tenant subscription/trial-state check.
   * Use this ONLY on routes that must remain accessible regardless of billing
   * state — specifically subscription management and invoice-payment endpoints —
   * so that `pending_payment` tenants can still reach the payment completion flow.
   */
  skipTenantStatusCheck?: boolean;
};

export async function requireAuth(req: Request, res: Response, options?: RequireAuthOptions): Promise<AuthedUser | null> {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated", code: "UNAUTHORIZED", message: "Not authenticated", requestId: req.id ?? "unknown" });
    return null;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, userId)).limit(1);
  if (!user) {
    res.status(401).json({ error: "User not provisioned", code: "USER_NOT_PROVISIONED", message: "User not provisioned", requestId: req.id ?? "unknown" });
    return null;
  }
  // Superadmins may not have a tenantId (they manage the platform globally)
  if (!user.tenantId && user.role !== ROLES.SUPER_ADMIN) {
    res.status(401).json({ error: "User not provisioned", code: "USER_NOT_PROVISIONED", message: "User not provisioned", requestId: req.id ?? "unknown" });
    return null;
  }

  // Enforce subscription/trial state for tenant-scoped users unless the caller
  // explicitly opts out (for billing/payment-completion routes only).
  if (user.tenantId && user.role !== ROLES.SUPER_ADMIN && !options?.skipTenantStatusCheck) {
    const allowed = await checkTenantAccess(user.tenantId, req, res);
    if (!allowed) return null;
  }

  // Return superadmin with empty string tenantId so routes using me.tenantId gracefully return empty results
  const authed = { ...user, tenantId: user.tenantId ?? "" } as AuthedUser;
  req.tenantId = authed.tenantId;
  req.userId = authed.id;
  return authed;
}

export async function getTenantUser(req: Request): Promise<AuthedUser | null> {
  const { userId } = getAuth(req);
  if (!userId) return null;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, userId)).limit(1);
  if (!user) return null;
  if (!user.tenantId && user.role !== ROLES.SUPER_ADMIN) return null;
  return { ...user, tenantId: user.tenantId ?? "" } as AuthedUser;
}

export function requireRole(allowedRoles: string[]) {
  return async (req: Request, res: Response, next: () => void): Promise<void> => {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!allowedRoles.includes(me.role)) {
      res.status(403).json({ error: "Forbidden: insufficient role", code: "FORBIDDEN_ROLE", message: "Forbidden: insufficient role", requestId: (req as import("express").Request & { id?: string }).id ?? "unknown" });
      return;
    }
    next();
  };
}
