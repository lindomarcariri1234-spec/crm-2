import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, tenantsTable, invitesTable, clientsTable, storesTable, tripsTable } from "@workspace/db";
import { eq, and, gt, sql } from "drizzle-orm";
import { generateId } from "../lib/id";
import { requireAuth, checkTenantAccess, ADMIN_ROLES } from "../lib/tenant";
import { checkPlanLimit } from "../lib/planLimits";
import {
  SyncMeBody,
  CreateUserBody,
  UpdateUserBody,
  GetMeResponse,
  SyncMeResponse,
} from "@workspace/api-zod";
import { getAuth, clerkClient } from "@clerk/express";
import { ROLES, RESOURCES, ACTIONS, hasPermission } from "@workspace/permissions";
import { AppError, ForbiddenError, NotFoundError, ValidationError, ConflictError } from "../lib/errors";

const router = Router();

function formatUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id, clerkId: u.clerkId, name: u.name, email: u.email, role: u.role,
    avatarUrl: u.avatarUrl, isActive: u.isActive, tenantId: u.tenantId,
    referralCode: u.referralCode, referralBalance: Number(u.referralBalance),
    commissionType: u.commissionType ?? "percentage",
    commissionRate: Number(u.commissionRate ?? 0),
    commissionFixed: Number(u.commissionFixed ?? 0),
    monthlyGoal: u.monthlyGoal != null ? Number(u.monthlyGoal) : null,
    createdAt: u.createdAt.toISOString(),
  };
}

router.get("/users/me", async (req, res, next): Promise<void> => {
  try {
    const { userId: clerkId } = getAuth(req);
    if (!clerkId) { next(new AppError("Not authenticated", 401, "UNAUTHENTICATED")); return; }

    const [user] = await db.select().from(usersTable)
      .where(eq(usersTable.clerkId, clerkId))
      .limit(1);
    if (!user) { next(new NotFoundError("User not found", "USER_NOT_FOUND")); return; }
    // Check the agency status at the login entry point. Do not use a users-plan
    // limit here: a limit controls creation of another profile, not whether an
    // existing staff member can sign in.
    if (user.tenantId && user.role !== ROLES.SUPER_ADMIN) {
      const allowed = await checkTenantAccess(user.tenantId, req, res);
      if (!allowed) return;
    }
    let tenant = null;
    let trialDaysLeft: number | null = null;
    if (user.tenantId) {
      const [t] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, user.tenantId)).limit(1);
      if (t) {
        tenant = {
          id: t.id, name: t.name, slug: t.slug, logoUrl: t.logoUrl,
          primaryColor: t.primaryColor, secondaryColor: t.secondaryColor,
          status: t.status, planId: t.planId, website: t.website,
          settings: t.settings ?? {},
        };
        // Surface trial days remaining for non-superadmin users when expiry is within 7 days
        if (
          t.status === "trial" &&
          t.trialEndsAt != null &&
          user.role !== ROLES.SUPER_ADMIN
        ) {
          const msLeft = t.trialEndsAt.getTime() - Date.now();
          const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
          if (daysLeft >= 0 && daysLeft <= 7) {
            trialDaysLeft = daysLeft;
          }
        }
      }
    }
    res.json({
      id: user.id, clerkId: user.clerkId, name: user.name, email: user.email,
      role: user.role, avatarUrl: user.avatarUrl, isActive: user.isActive,
      tenantId: user.tenantId, referralCode: user.referralCode,
      referralBalance: Number(user.referralBalance), createdAt: user.createdAt.toISOString(),
      commissionType: user.commissionType ?? "percentage",
      commissionRate: user.commissionRate != null ? Number(user.commissionRate) : null,
      commissionFixed: user.commissionFixed != null ? Number(user.commissionFixed) : null,
      monthlyGoal: user.monthlyGoal != null ? Number(user.monthlyGoal) : null,
      trialDaysLeft,
      tenant,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Normalizes an email for comparison purposes: trims surrounding whitespace and
 * lowercases it. Invite matching must be tolerant of case/whitespace differences
 * between what an inviter typed and the canonical email Clerk reports for the
 * account, or an accepted invite can get stuck as "pending" forever.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function resolveInviteForUser(
  clerkId: string,
  canonicalEmail: string,
  inviteIdFromMeta: string | undefined,
  log: import("pino").Logger,
): Promise<typeof invitesTable.$inferSelect | undefined> {
  const normalizedEmail = normalizeEmail(canonicalEmail);

  if (inviteIdFromMeta) {
    const [byId] = await db.select().from(invitesTable)
      .where(and(
        eq(invitesTable.id, inviteIdFromMeta),
        eq(invitesTable.accepted, false),
        sql`lower(trim(${invitesTable.email})) = ${normalizedEmail}`,
        gt(invitesTable.expiresAt, new Date()),
      ))
      .limit(1);
    if (byId) return byId;
    log.warn({ clerkId, inviteIdFromMeta }, "Clerk metadata inviteId found but email mismatch or expired — ignoring for security");
  }

  const [byEmail] = await db.select().from(invitesTable)
    .where(and(
      sql`lower(trim(${invitesTable.email})) = ${normalizedEmail}`,
      eq(invitesTable.accepted, false),
      gt(invitesTable.expiresAt, new Date()),
    ))
    .limit(1);
  return byEmail;
}

/**
 * Looks for a pending invite that should win over a user's *current* tenant
 * link, for the narrow case where that current tenant is a self-provisioned
 * placeholder the user never actually used (e.g. they clicked through onboarding
 * before a teammate invite from a different agency arrived). This must never
 * touch a tenant with real data or other members — it only unblocks a user who
 * is otherwise invisible to the agency that invited them.
 */
async function resolveStaleTenantInvite(
  clerkId: string,
  currentTenantId: string,
  currentRole: string,
  canonicalEmail: string,
  log: import("pino").Logger,
): Promise<typeof invitesTable.$inferSelect | undefined> {
  // Only ever reconsider a self-provisioned agency owner. A vendedor/gerente
  // that was properly provisioned into a real tenant is never a candidate —
  // this keeps the check from ever disturbing an established staff member.
  if (currentRole !== ROLES.AGENCY_ADMIN) return undefined;

  const candidate = await resolveInviteForUser(clerkId, canonicalEmail, undefined, log);
  if (!candidate || candidate.tenantId === currentTenantId) return undefined;

  const [[teammates], [trips]] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.tenantId, currentTenantId)).limit(1),
    db.select({ count: sql<number>`count(*)::int` }).from(tripsTable).where(eq(tripsTable.tenantId, currentTenantId)).limit(1),
  ]);

  if (Number(teammates?.count ?? 0) > 1 || Number(trips?.count ?? 0) > 0) {
    log.warn(
      { clerkId, currentTenantId, inviteTenantId: candidate.tenantId },
      "Pending invite found for a user whose current tenant already has real data or other members — leaving both untouched",
    );
    return undefined;
  }

  return candidate;
}

router.post("/users/me/sync", async (req, res, next): Promise<void> => {
  try {
    const auth = getAuth(req);
    const { userId: clerkId } = getAuth(req);
    if (!clerkId) {
      req.log.warn({
        sessionId: auth.sessionId ?? null,
        hasAuthHeader: !!req.headers["authorization"],
        hasSessionCookie: !!req.cookies?.["__session"],
        sessionClaimsKeys: auth.sessionClaims ? Object.keys(auth.sessionClaims) : null,
        origin: req.headers["origin"] ?? null,
      }, "[auth] getAuth returned null userId on POST /users/me/sync — token missing or rejected");
      next(new AppError("Not authenticated", 401, "UNAUTHENTICATED")); return;
    }

    const parsed = SyncMeBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "VALIDATION_ERROR")); return; }

    const { name, avatarUrl } = parsed.data;

    let canonicalEmail = parsed.data.email;
    let inviteIdFromMeta: string | undefined;
    let clerkFetchFailed = false;

    try {
      const clerkUser = await clerkClient.users.getUser(clerkId);
      const primaryEmail = clerkUser.emailAddresses.find(e => e.id === clerkUser.primaryEmailAddressId);
      if (primaryEmail?.emailAddress) {
        canonicalEmail = primaryEmail.emailAddress;
      }
      inviteIdFromMeta = (clerkUser.publicMetadata as Record<string, string> | undefined)?.inviteId;
    } catch (clerkErr) {
      req.log.warn({ clerkErr, clerkId }, "Failed to fetch Clerk user; using client-supplied email for profile update only (no invite reconciliation)");
      clerkFetchFailed = true;
    }

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1);

    if (!existing) {
    const userId = generateId();
    const referralCode = (await import("crypto")).randomBytes(4).toString("hex").substring(0, 6).toUpperCase();

      let pendingInvite: typeof invitesTable.$inferSelect | undefined;
      if (!clerkFetchFailed) {
        pendingInvite = await resolveInviteForUser(clerkId, canonicalEmail, inviteIdFromMeta, req.log);
      }

      let linkedTenantId = pendingInvite?.tenantId ?? null;
      const superadminClerkId = process.env.SUPERADMIN_CLERK_ID;
      let assignedRole = (superadminClerkId && clerkId === superadminClerkId) ? ROLES.SUPER_ADMIN : (pendingInvite?.role ?? ROLES.AGENCY_ADMIN);

      // When a storeSlug is provided and there is no pending invite, register the
      // new user as a CLIENT of that agency.  Skip for superadmin clerkIds and
      // for users that were already matched to an invite (invite takes precedence).
      if (
        parsed.data.storeSlug &&
        !pendingInvite &&
        assignedRole === ROLES.AGENCY_ADMIN
      ) {
        const [storeRow] = await db
          .select({ tenantId: storesTable.tenantId })
          .from(storesTable)
          .where(and(eq(storesTable.slug, parsed.data.storeSlug), eq(storesTable.isActive, true)))
          .limit(1);
        if (storeRow) {
          linkedTenantId = storeRow.tenantId;
          assignedRole = ROLES.CLIENT;
          req.log.info({ clerkId, storeSlug: parsed.data.storeSlug, tenantId: storeRow.tenantId }, "New user registered via storefront — assigned role CLIENT");
        }
      }

      if (linkedTenantId) {
        const hasTenantAccess = await checkTenantAccess(linkedTenantId, req, res);
        if (!hasTenantAccess) return;
        const allowed = await checkPlanLimit(linkedTenantId, "users", req, res);
        if (!allowed) return;
      }

      await db.insert(usersTable).values({
        id: userId, clerkId, tenantId: linkedTenantId, name, email: canonicalEmail,
        avatarUrl: avatarUrl ?? null, role: assignedRole,
        referralCode, referralBalance: "0",
      });

      if (pendingInvite) {
        await db.update(invitesTable)
          .set({ accepted: true, acceptedAt: new Date() })
          .where(eq(invitesTable.id, pendingInvite.id));
      }

      const [newUser] = await db.select().from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      if (!newUser) { next(new AppError("Failed to create user", 500, "USER_CREATE_FAILED")); return; }
      res.json(SyncMeResponse.parse({
        id: newUser.id, clerkId: newUser.clerkId, name: newUser.name, email: newUser.email,
        role: newUser.role, avatarUrl: newUser.avatarUrl, isActive: newUser.isActive,
        tenantId: newUser.tenantId, referralCode: newUser.referralCode,
        referralBalance: Number(newUser.referralBalance), createdAt: newUser.createdAt.toISOString(),
      }));
    } else {
      // Resolve any winning invite BEFORE gating on the current tenant's access
      // status. A self-provisioned placeholder tenant can expire or be
      // suspended before the user's real invite arrives; checking access on
      // that placeholder first would permanently lock the user out even though
      // a valid invite to a different, active tenant is waiting for them. See
      // resolveStaleTenantInvite for the safety conditions on Case B.
      let reconcileInvite: typeof invitesTable.$inferSelect | undefined;
      let staleTenantInvite: typeof invitesTable.$inferSelect | undefined;
      if (!clerkFetchFailed) {
        // Case A: the account has no tenant at all (most common — e.g. it was
        // created before a matching invite existed, or a previous sync attempt
        // hit a transient Clerk failure). Every subsequent successful login
        // retries this until it succeeds or no invite matches.
        reconcileInvite = existing.tenantId
          ? undefined
          : await resolveInviteForUser(clerkId, canonicalEmail, inviteIdFromMeta, req.log);

        // Case B: the account already has a tenant, but it is a self-provisioned
        // placeholder (e.g. the user clicked through onboarding before a
        // teammate invite from a *different* agency arrived) and a pending
        // invite for a real agency is now waiting. Resolved conservatively —
        // see resolveStaleTenantInvite for the safety conditions.
        staleTenantInvite = (existing.tenantId && !reconcileInvite)
          ? await resolveStaleTenantInvite(clerkId, existing.tenantId, existing.role, canonicalEmail, req.log)
          : undefined;
      }
      const winningInvite = reconcileInvite ?? staleTenantInvite;

      // Existing users only need their tenant's access status checked. Applying
      // a users-plan limit here would block someone from logging in merely
      // because their agency has already reached its account capacity. Skip
      // this check on the *current* tenant when a winning invite is about to
      // move the user off of it entirely — its (possibly expired/suspended)
      // status is no longer relevant once they are being reconciled elsewhere.
      //
      // Instead, when there IS a winning invite, its *target* tenant's access
      // status must be checked before reconciliation is finalized. Otherwise a
      // user could be silently reconciled onto a tenant that is itself
      // suspended or has an expired trial, only to be blocked on their very
      // next login once checkTenantAccess runs against the new tenantId. Leave
      // the invite pending and the user on their current tenant so this can be
      // retried once the target tenant's access is restored.
      if (winningInvite) {
        const targetTenantAllowed = await checkTenantAccess(winningInvite.tenantId, req, res);
        if (!targetTenantAllowed) return;
      } else if (existing.tenantId && existing.role !== ROLES.SUPER_ADMIN) {
        const allowed = await checkTenantAccess(existing.tenantId, req, res);
        if (!allowed) return;
      }

      const updateSet: Record<string, unknown> = {
        name,
        email: canonicalEmail,
        avatarUrl: avatarUrl ?? null,
        lastLoginAt: new Date(),
      };

      const superadminClerkIdForUpdate = process.env.SUPERADMIN_CLERK_ID;
      if (superadminClerkIdForUpdate && clerkId === superadminClerkIdForUpdate && existing.role !== ROLES.SUPER_ADMIN) {
        updateSet.role = ROLES.SUPER_ADMIN;
        req.log.info({ clerkId, userId: existing.id }, "Auto-promoted user to superadmin via SUPERADMIN_CLERK_ID");
      }

      if (winningInvite) {
        const fromTenantId = existing.tenantId;
        updateSet.tenantId = winningInvite.tenantId;
        // Never downgrade a superadmin via invite reconciliation
        if (updateSet.role !== ROLES.SUPER_ADMIN) {
          updateSet.role = winningInvite.role;
        }
        await db.update(invitesTable)
          .set({ accepted: true, acceptedAt: new Date() })
          .where(eq(invitesTable.id, winningInvite.id));
        if (staleTenantInvite) {
          req.log.info(
            { clerkId, userId: existing.id, fromTenantId, toTenantId: winningInvite.tenantId, inviteId: winningInvite.id },
            "Reconciled user off an unused self-provisioned tenant onto a pending staff invite",
          );
        }
      }

      await db.update(usersTable).set(updateSet)
        .where(eq(usersTable.clerkId, clerkId));
      const [updatedUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1);
      if (!updatedUser) { next(new NotFoundError("User not found after update", "USER_NOT_FOUND")); return; }
      res.json(SyncMeResponse.parse({
        id: updatedUser.id, clerkId: updatedUser.clerkId, name: updatedUser.name, email: updatedUser.email,
        role: updatedUser.role, avatarUrl: updatedUser.avatarUrl, isActive: updatedUser.isActive,
        tenantId: updatedUser.tenantId, referralCode: updatedUser.referralCode,
        referralBalance: Number(updatedUser.referralBalance), createdAt: updatedUser.createdAt.toISOString(),
      }));
    }
  } catch (err) {
    next(err);
  }
});

router.get("/users", async (req, res, next): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.TEAM, ACTIONS.VIEW)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const users = await db.select().from(usersTable).where(eq(usersTable.tenantId, me.tenantId));
    res.json(users.map(formatUser));
  } catch (err) {
    next(err);
  }
});

router.post("/users", async (req, res, next): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Apenas administradores podem criar usuarios", "FORBIDDEN_ROLE")); return;
    }
    if (me.tenantId && me.role !== ROLES.SUPER_ADMIN) {
      const allowed = await checkPlanLimit(me.tenantId, "users", req, res);
      if (!allowed) return;
    }
    const parsed = CreateUserBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "VALIDATION_ERROR")); return; }
    if (me.role !== ROLES.SUPER_ADMIN && parsed.data.role === ROLES.SUPER_ADMIN) {
      next(new ForbiddenError("Forbidden: apenas superadmins podem atribuir a funcao superadmin", "FORBIDDEN_ROLE")); return;
    }
    const userId = generateId();
    const referralCode = (await import("crypto")).randomBytes(4).toString("hex").substring(0, 6).toUpperCase();
    const pendingClerkId = "pending-" + userId;
    await db.insert(usersTable).values({
      id: userId,
      clerkId: pendingClerkId,
      tenantId: me.tenantId,
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      referralCode,
      referralBalance: "0",
    });
    const [user] = await db.select().from(usersTable)
      .where(eq(usersTable.clerkId, pendingClerkId))
      .limit(1);
    if (!user) { next(new AppError("Failed to create user", 500, "USER_CREATE_FAILED")); return; }
    res.status(201).json(formatUser(user));
  } catch (err) {
    next(err);
  }
});

router.patch("/users/:id", async (req, res, next): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = UpdateUserBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "VALIDATION_ERROR")); return; }
    const updates: Partial<typeof usersTable.$inferInsert> = {};
    const isSelf = req.params.id === me.id;
    if (parsed.data.name != null) {
      if (!isSelf && !ADMIN_ROLES.includes(me.role)) {
        next(new ForbiddenError("Forbidden: apenas administradores podem alterar dados de outros usuários", "FORBIDDEN_ROLE")); return;
      }
      updates.name = parsed.data.name;
    }
    if (parsed.data.role != null || parsed.data.isActive != null) {
      const adminRoles = ADMIN_ROLES;
      if (!adminRoles.includes(me.role)) {
        next(new ForbiddenError("Forbidden: apenas administradores podem alterar funcao ou status", "FORBIDDEN_ROLE")); return;
      }
      if (parsed.data.role != null) {
        if (me.role !== ROLES.SUPER_ADMIN && parsed.data.role === ROLES.SUPER_ADMIN) {
          next(new ForbiddenError("Forbidden: apenas superadmins podem atribuir a funcao superadmin", "FORBIDDEN_ROLE")); return;
        }
        updates.role = parsed.data.role;
      }
      if (parsed.data.isActive != null) updates.isActive = parsed.data.isActive;
    }
    // Commission config — admin only
    const hasCommissionFields = parsed.data.commissionType != null || parsed.data.commissionRate != null || parsed.data.commissionFixed != null || "monthlyGoal" in parsed.data;
    if (hasCommissionFields) {
      const adminRoles = ADMIN_ROLES;
      if (!adminRoles.includes(me.role)) {
        next(new ForbiddenError("Forbidden: apenas administradores podem alterar configuração de comissão", "FORBIDDEN_ROLE")); return;
      }
      if (parsed.data.commissionType != null) updates.commissionType = parsed.data.commissionType;
      if (parsed.data.commissionRate != null) updates.commissionRate = String(parsed.data.commissionRate);
      if (parsed.data.commissionFixed != null) updates.commissionFixed = String(parsed.data.commissionFixed);
      if ("monthlyGoal" in parsed.data) updates.monthlyGoal = parsed.data.monthlyGoal != null ? String(parsed.data.monthlyGoal) : null;
    }
    await db.update(usersTable).set(updates)
      .where(and(eq(usersTable.id, req.params.id), eq(usersTable.tenantId, me.tenantId)));
    const [user] = await db.select().from(usersTable)
      .where(and(eq(usersTable.id, req.params.id), eq(usersTable.tenantId, me.tenantId)))
      .limit(1);
    if (!user) { next(new NotFoundError("Not found", "USER_NOT_FOUND")); return; }
    res.json(formatUser(user));
  } catch (err) {
    next(err);
  }
});

router.delete("/users/me", async (req, res, next): Promise<void> => {
  try {
    const { userId: clerkId } = getAuth(req);
    if (!clerkId) { next(new AppError("Not authenticated", 401, "UNAUTHENTICATED")); return; }

    const [user] = await db.select().from(usersTable)
      .where(eq(usersTable.clerkId, clerkId))
      .limit(1);
    if (!user) { next(new NotFoundError("Usuário não encontrado", "USER_NOT_FOUND")); return; }

    if (user.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Apenas clientes podem excluir a própria conta pelo portal.", "FORBIDDEN_ROLE")); return;
    }

    try {
      await clerkClient.users.deleteUser(clerkId);
    } catch (clerkErr: unknown) {
      const status = (clerkErr as { status?: number })?.status;
      if (status !== 404) {
        next(new AppError("Não foi possível remover a conta de autenticação. Tente novamente.", 502, "CLERK_DELETE_FAILED")); return;
      }
    }

    await db.transaction(async (tx) => {
      await tx.update(clientsTable)
        .set({ userId: sql`NULL` })
        .where(eq(clientsTable.userId, user.id));
      await tx.delete(usersTable).where(eq(usersTable.id, user.id));
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
