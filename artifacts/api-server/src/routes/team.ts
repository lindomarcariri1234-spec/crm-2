import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { db, usersTable, invitesTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { ADMIN_ROLES, ALL_STAFF_ROLES } from '../lib/tenant';
import { ROLES } from "@workspace/permissions";
import { ForbiddenError, NotFoundError, ValidationError, ConflictError, AppError } from "../lib/errors";

const router = Router();

router.get("/team/members", async (req, res, next): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ALL_STAFF_ROLES.includes(me.role)) {
      next(new ForbiddenError("Acesso negado", "FORBIDDEN_ROLE")); return;
    }
    const members = await db.select().from(usersTable).where(and(eq(usersTable.tenantId, me.tenantId), eq(usersTable.role, ROLES.SALES)));
    res.json(members.map(u => ({
      id: u.id,
      clerkId: u.clerkId,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      avatarUrl: u.avatarUrl,
      createdAt: u.createdAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

router.get("/team/invites", async (req, res, next): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Apenas gestores podem ver convites pendentes", "FORBIDDEN_ROLE")); return;
    }
    const invites = await db.select().from(invitesTable).where(eq(invitesTable.tenantId, me.tenantId));
    res.json(invites.map(i => ({
      id: i.id,
      email: i.email,
      role: i.role,
      accepted: i.accepted,
      acceptedAt: i.acceptedAt?.toISOString() ?? null,
      expiresAt: i.expiresAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

const InviteBody = z.object({
  email: z.string().email("E-mail inválido"),
  role: z.literal(ROLES.SALES).optional().default(ROLES.SALES),
});

router.post("/team/invite", async (req, res, next): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (!ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Apenas gestores podem convidar membros", "FORBIDDEN_ROLE")); return;
    }

    const parsed = InviteBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.message, "VALIDATION_ERROR")); return;
    }

    const { email, role } = parsed.data;

    const [existingUser] = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        eq(usersTable.email, email),
        eq(usersTable.tenantId, me.tenantId),
      ))
      .limit(1);

    if (existingUser) {
      next(new ConflictError("Este e-mail já pertence a um membro da equipe", "CONFLICT")); return;
    }

    const now = new Date();
    const [pendingInvite] = await db.select({ id: invitesTable.id })
      .from(invitesTable)
      .where(and(
        eq(invitesTable.email, email),
        eq(invitesTable.tenantId, me.tenantId),
        eq(invitesTable.accepted, false),
        gt(invitesTable.expiresAt, now),
      ))
      .limit(1);

    if (pendingInvite) {
      next(new ConflictError("Já existe um convite pendente para este e-mail", "CONFLICT")); return;
    }

    const inviteId = generateId();
    const token = generateId();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    let clerkInviteId: string | null = null;

    try {
      const proxyUrl = process.env.CLERK_PROXY_URL;
      const frontendUrl = process.env.FRONTEND_URL;
      const baseUrl = (
        (proxyUrl ? proxyUrl.replace(/\/api\/__clerk\/?$/, "") : null) ||
        frontendUrl ||
        null
      )?.replace(/\/$/, "");
      const redirectUrl = baseUrl ? `${baseUrl}/sign-up` : undefined;

      const clerkInvite = await clerkClient.invitations.createInvitation({
        emailAddress: email,
        expiresInDays: 7,
        ignoreExisting: true,
        notify: true,
        redirectUrl,
        publicMetadata: {
          tenantId: me.tenantId,
          role,
          inviteId,
        },
      });
      clerkInviteId = clerkInvite.id;
    } catch (clerkErr) {
      req.log.warn({ clerkErr, email }, "Clerk invitation creation failed, falling back to manual invite");
    }

    await db.insert(invitesTable).values({
      id: inviteId,
      tenantId: me.tenantId,
      email,
      role,
      invitedBy: me.id,
      token: clerkInviteId ?? token,
      accepted: false,
      expiresAt,
    });

    res.status(201).json({
      id: inviteId,
      email,
      role,
      clerkInviteId,
      expiresAt: expiresAt.toISOString(),
      message: clerkInviteId
        ? `Convite enviado para ${email} via e-mail.`
        : `Convite registrado para ${email}. O convidado deve criar uma conta com este e-mail.`,
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/team/invites/:id", async (req, res, next): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (!ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Apenas gestores podem cancelar convites", "FORBIDDEN_ROLE")); return;
    }

    const [invite] = await db.select()
      .from(invitesTable)
      .where(and(
        eq(invitesTable.id, req.params.id),
        eq(invitesTable.tenantId, me.tenantId),
      ))
      .limit(1);

    if (invite) {
      try {
        await clerkClient.invitations.revokeInvitation(invite.token);
      } catch (clerkErr) {
        req.log.warn({ clerkErr }, "Could not revoke Clerk invitation (may already be used or revoked)");
      }
      await db.delete(invitesTable).where(eq(invitesTable.id, invite.id));
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/team/members/:id", async (req, res, next): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (!ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Apenas gestores podem remover membros", "FORBIDDEN_ROLE")); return;
    }

    if (req.params.id === me.id) {
      next(new ValidationError("Você não pode remover a si mesmo da equipe", "SELF_REMOVE")); return;
    }

    await db.update(usersTable)
      .set({ isActive: false })
      .where(and(
        eq(usersTable.id, req.params.id),
        eq(usersTable.tenantId, me.tenantId),
      ));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
