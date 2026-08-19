// Clerk portal account provisioning. Kept separate from `checkout-user.ts`
// (CRM client upsert) because this runs OUTSIDE the order transaction —
// Clerk API calls cannot participate in the DB transaction and are invoked
// post-commit from `post-booking.ts` as fire-and-forget.
import { randomBytes } from "crypto";
import { logger } from "../../lib/logger";
import { clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { generateId, generateReferralCode } from "../../lib/id";
import { sendWelcomeEmail } from "../../queues/email-helpers";
import { ROLES } from "@workspace/permissions";

export interface PortalCredentials {
  email: string;
  setupUrl: string;
  loginUrl: string;
  plainTextPassword?: string;
}

export interface EnsurePortalAccountArgs {
  email: string;
  name: string;
  tenantId: string;
  storeBase: string;
  loginUrl: string;
  agencyName: string;
  agencyLogo: string;
}

function generateTemporaryPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "@#$!";
  const all = upper + lower + digits + special;
  const bytes = randomBytes(16);
  let pwd = upper[bytes[0] % upper.length]
    + lower[bytes[1] % lower.length]
    + digits[bytes[2] % digits.length]
    + special[bytes[3] % special.length];
  for (let i = 4; i < 12; i++) {
    pwd += all[bytes[i] % all.length];
  }
  const arr = pwd.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}

export async function ensurePortalAccount(
  args: EnsurePortalAccountArgs,
): Promise<{ credentials?: PortalCredentials }> {
  const { email, name, tenantId, storeBase, loginUrl, agencyName, agencyLogo } = args;

  const [existingUser] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.email, email), eq(usersTable.tenantId, tenantId)))
    .limit(1);

  if (existingUser) return {};

  const bootstrapPassword = generateTemporaryPassword();
  let newClerkId: string | null = null;

  try {
    const nameParts = name.trim().split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || undefined;
    const clerkUser = await clerkClient.users.createUser({
      emailAddress: [email],
      password: bootstrapPassword,
      firstName,
      ...(lastName ? { lastName } : {}),
    });
    newClerkId = clerkUser.id;
  } catch (clerkErr: unknown) {
    const errors = (clerkErr as { errors?: Array<{ code: string }> })?.errors ?? [];
    const isDuplicate = errors.some((e) => e.code === "form_identifier_exists");
    if (!isDuplicate) {
      logger.error({ err: clerkErr }, "[checkout/portal-account] Clerk user creation error");
    }
  }

  if (!newClerkId) return {};

  const referralBase = generateReferralCode(name);
  const referralSuffix = randomBytes(2).toString("hex").toUpperCase();
  const referralCode = `${referralBase}${referralSuffix}`;
  await db.insert(usersTable).values({
    id: generateId(),
    clerkId: newClerkId,
    tenantId,
    name,
    email,
    role: ROLES.CLIENT,
    isActive: true,
    referralCode,
  });

  const portalUrl = `${storeBase}/perfil`;
  let setupUrl: string = portalUrl;
  let credentials: PortalCredentials | undefined;

  try {
    const signInToken = await clerkClient.signInTokens.createSignInToken({
      userId: newClerkId,
      expiresInSeconds: 604800,
    });
    const redirectParam = encodeURIComponent(portalUrl);
    const tokenBase = signInToken.url;
    setupUrl = tokenBase.includes("?")
      ? `${tokenBase}&redirect_url=${redirectParam}`
      : `${tokenBase}?redirect_url=${redirectParam}`;
    credentials = { email, setupUrl, loginUrl, plainTextPassword: bootstrapPassword };
  } catch (tokenErr) {
    logger.error({ err: tokenErr }, "[checkout/portal-account] Failed to create sign-in token");
    credentials = { email, setupUrl: loginUrl, loginUrl, plainTextPassword: bootstrapPassword };
  }

  sendWelcomeEmail(
    {
      clientName: name,
      clientEmail: email,
      setupUrl,
      loginUrl,
      agencyName,
      agencyLogo: agencyLogo || null,
      isMagicLink: credentials !== undefined,
      plainTextPassword: bootstrapPassword,
    },
    tenantId,
  ).catch((welcomeErr) => {
    logger.error({ err: welcomeErr }, "[checkout/portal-account] Failed to send welcome email");
  });

  return { credentials };
}
