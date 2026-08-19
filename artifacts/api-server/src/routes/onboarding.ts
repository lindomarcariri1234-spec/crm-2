import { Router, type NextFunction } from "express";
import { db, tenantsTable, usersTable, plansTable, storesTable } from "@workspace/db";
import { eq, asc, ilike } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { getAuth, clerkClient } from "@clerk/express";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../lib/errors";
import { ROLES } from "@workspace/permissions";

const router = Router();

function requireAuthLight(req: import("express").Request): { clerkId: string } {
  const { userId } = getAuth(req);
  if (!userId) {
    throw new AppError("Not authenticated", 401, "UNAUTHORIZED");
  }
  return { clerkId: userId };
}

router.get("/onboarding/status", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const auth = requireAuthLight(req);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, auth.clerkId)).limit(1);
    if (!user) {
      res.json({ onboardingComplete: false, hasTenant: false, user: null });
      return;
    }
    res.json({
      onboardingComplete: !!user.tenantId,
      hasTenant: !!user.tenantId,
      tenantId: user.tenantId ?? null,
      role: user.role,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching onboarding status");
    next(err);
  }
});

const AgencyOnboardingBody = z.object({
  name: z.string().min(2, "Nome da agência deve ter pelo menos 2 caracteres"),
  cnpj: z.string().optional(),
  phone: z.string().optional(),
  slug: z.string()
    .min(2, "Slug deve ter pelo menos 2 caracteres")
    .regex(/^[a-z0-9-]+$/, "Slug deve conter apenas letras minúsculas, números e hífens"),
  planId: z.string().optional().default("starter"),
  skipSetup: z.literal(false).optional(),
});

const SkipOnboardingBody = z.object({ skipSetup: z.literal(true) });

/** Returns the first slug derived from `base` that is not already taken in tenants or stores. */
async function findUniqueSlug(base: string): Promise<string> {
  let candidate = base;
  for (let attempt = 1; attempt <= 99; attempt++) {
    const [[t], [s]] = await Promise.all([
      db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.slug, candidate)).limit(1),
      db.select({ id: storesTable.id }).from(storesTable).where(eq(storesTable.slug, candidate)).limit(1),
    ]);
    if (!t && !s) return candidate;
    candidate = `${base}-${attempt}`;
  }
  // Extremely unlikely fallback — append a random suffix
  return `${base}-${(await import("crypto")).randomBytes(3).toString("hex")}`;
}

router.post("/onboarding/agency", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const auth = requireAuthLight(req);

    let [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, auth.clerkId)).limit(1);
    if (!user) {
      // Defensive upsert: the frontend should have called /users/me/sync first,
      // but if it didn't (e.g. direct navigation, network race), create the user
      // row now from Clerk data so the onboarding form submission can proceed.
      let clerkUser: Awaited<ReturnType<typeof clerkClient.users.getUser>>;
      try {
        clerkUser = await clerkClient.users.getUser(auth.clerkId);
      } catch (clerkErr) {
        req.log.error({ clerkErr, clerkId: auth.clerkId }, "Failed to fetch Clerk user during onboarding auto-provision");
        next(new NotFoundError("User not found. Please refresh and try again.", "USER_NOT_FOUND"));
        return;
      }

      const primaryEmail = clerkUser.emailAddresses.find(e => e.id === clerkUser.primaryEmailAddressId);
      const email = primaryEmail?.emailAddress ?? "";
      const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || "Usuário";
      const userId = generateId();
      const referralCode = (await import("crypto")).randomBytes(4).toString("hex").substring(0, 6).toUpperCase();
      const superadminClerkId = process.env.SUPERADMIN_CLERK_ID;
      const role = (superadminClerkId && auth.clerkId === superadminClerkId) ? ROLES.SUPER_ADMIN : ROLES.AGENCY_ADMIN;

      // Ignore unique-constraint violations — a concurrent /users/me/sync may
      // have inserted the row while this request was in flight.
      await db.insert(usersTable).values({
        id: userId, clerkId: auth.clerkId, tenantId: null, name, email,
        avatarUrl: clerkUser.imageUrl ?? null, role, referralCode, referralBalance: "0",
      }).onConflictDoNothing();

      // Re-read winner (our insert or the concurrent one).
      const [provisioned] = await db.select().from(usersTable).where(eq(usersTable.clerkId, auth.clerkId)).limit(1);
      if (!provisioned) {
        next(new AppError("Failed to provision user", 500, "USER_CREATE_FAILED"));
        return;
      }
      user = provisioned;
    }
    if (user.tenantId) {
      next(new ConflictError("User already has a tenant assigned", "TENANT_ALREADY_ASSIGNED"));
      return;
    }

    // ── Determine name/slug/planId — either from the form or auto-generated ──
    let name: string, cnpj: string | undefined, phone: string | undefined, slug: string, planId: string;

    if (SkipOnboardingBody.safeParse(req.body).success) {
      // Skip path: auto-generate values, no user input required.
      const baseSlug = `agencia-${auth.clerkId.slice(-6).toLowerCase()}`;
      slug = await findUniqueSlug(baseSlug);
      name = "Minha Agência";
      cnpj = undefined;
      phone = undefined;
      // Use the Starter plan if it exists; fall back to the literal string "starter".
      const [starterPlan] = await db
        .select({ id: plansTable.id })
        .from(plansTable)
        .where(ilike(plansTable.name, "starter"))
        .limit(1);
      if (!starterPlan) {
        req.log.warn("No Starter plan found in DB — using literal planId 'starter' for skip-onboarding path");
      }
      planId = starterPlan?.id ?? "starter";
    } else {
      const parsed = AgencyOnboardingBody.safeParse(req.body);
      if (!parsed.success) {
        next(new ValidationError(String(parsed.error.message)));
        return;
      }
      ({ name, cnpj, phone, slug, planId } = parsed.data);

      const [[existingTenantSlug], [existingStoreSlug]] = await Promise.all([
        db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.slug, slug)).limit(1),
        db.select({ id: storesTable.id }).from(storesTable).where(eq(storesTable.slug, slug)).limit(1),
      ]);
      if (existingTenantSlug || existingStoreSlug) {
        next(new ConflictError("Esse slug já está em uso. Escolha outro.", "SLUG_CONFLICT"));
        return;
      }
    }

    const tenantId = generateId();
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    let tenant: typeof tenantsTable.$inferSelect;
    try {
      [tenant] = await db.transaction(async (tx) => {
        await tx.insert(tenantsTable).values({
          id: tenantId,
          name,
          slug,
          email: user.email,
          cnpj: cnpj ?? null,
          phone: phone ?? null,
          planId: planId ?? "starter",
          status: "trial",
          trialEndsAt,
          limits: { users: 10, clients: 1000, trips: 50 },
          settings: { onboardingCompleted: true },
        });
        await tx.update(usersTable)
          .set({ tenantId, role: ROLES.AGENCY_ADMIN })
          .where(eq(usersTable.clerkId, auth.clerkId));

        const [existingStore] = await tx
          .select({ id: storesTable.id })
          .from(storesTable)
          .where(eq(storesTable.tenantId, tenantId))
          .limit(1);

        if (!existingStore) {
          await tx.insert(storesTable).values({
            id: generateId(),
            tenantId,
            name,
            slug,
            email: user.email,
            phone: phone ?? null,
            whatsapp: phone ?? null,
            notificationEmail: user.email,
            paymentMethods: ["pix", "credit_card", "boleto", "cash"],
            isActive: true,
          });
        }

        return tx.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
      });
    } catch (txErr) {
      const dbErr = txErr as { code?: string };
      if (dbErr?.code === "23505") {
        next(new ConflictError("Esse slug já está em uso. Escolha outro.", "SLUG_CONFLICT"));
        return;
      }
      req.log.error({ txErr }, "Onboarding transaction failed");
      next(new AppError("Erro ao criar agência. Tente novamente.", 500, "ONBOARDING_TX_FAILED"));
      return;
    }

    res.status(201).json({ tenant, onboardingComplete: true });
  } catch (err) {
    req.log.error({ err }, "Error completing agency onboarding");
    next(err);
  }
});

router.get("/onboarding/plans", async (req, res, next: NextFunction): Promise<void> => {
  try {
    requireAuthLight(req);
    const plans = await db.select().from(plansTable)
      .where(eq(plansTable.isActive, true))
      .orderBy(asc(plansTable.sortOrder), asc(plansTable.createdAt));
    res.json(plans);
  } catch (err) {
    req.log.error({ err }, "Error listing plans for onboarding");
    next(err);
  }
});

router.get("/onboarding/check-slug", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const slug = req.query["slug"] as string;
    if (!slug) {
      next(new ValidationError("slug query param required", "MISSING_PARAM"));
      return;
    }
    const [[existingTenant], [existingStore]] = await Promise.all([
      db.select({ id: tenantsTable.id }).from(tenantsTable).where(eq(tenantsTable.slug, slug)).limit(1),
      db.select({ id: storesTable.id }).from(storesTable).where(eq(storesTable.slug, slug)).limit(1),
    ]);
    res.json({ available: !existingTenant && !existingStore });
  } catch (err) {
    req.log.error({ err }, "Error checking slug");
    next(err);
  }
});

export default router;
