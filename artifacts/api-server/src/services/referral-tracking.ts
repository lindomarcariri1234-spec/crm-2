import { randomBytes } from "crypto";
import { db, clientsTable, referralsTable, referralTrackingTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { generateId } from "../lib/id";
import { ValidationError } from "../lib/errors";

type ReferralTrackingExecutor = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export interface ReferralVisitInput {
  tenantId: string;
  code: string;
  serverCookieId?: string;
  landingPage?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  ipAddress: string;
  userAgent: string;
  now?: Date;
}

export interface ReferralVisitResult {
  cookieId: string;
  referralCode: string;
  firstVisit: boolean;
  visitsCount: number;
}

function generateCookieId(): string {
  return randomBytes(16).toString("hex");
}

function detectDeviceType(ua: string): string {
  if (/mobile/i.test(ua)) return "mobile";
  if (/tablet/i.test(ua)) return "tablet";
  return "desktop";
}

function detectBrowser(ua: string): string {
  if (/edg/i.test(ua)) return "Edge";
  if (/chrome/i.test(ua)) return "Chrome";
  if (/firefox/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  return "Unknown";
}

function detectOS(ua: string): string {
  if (/windows/i.test(ua)) return "Windows";
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ios/i.test(ua)) return "iOS";
  if (/mac/i.test(ua)) return "MacOS";
  if (/linux/i.test(ua)) return "Linux";
  return "Unknown";
}

/**
 * Records a public referral visit and reconciles the CRM summary atomically.
 *
 * `referral_tracking` is the event-level source of truth. The aggregate is
 * copied to every CRM referral row sharing the code so the admin list, exports,
 * and historical rows see the same visit totals and dates.
 */
export async function recordReferralVisit(
  tx: ReferralTrackingExecutor,
  input: ReferralVisitInput,
): Promise<ReferralVisitResult> {
  const now = input.now ?? new Date();
  const [owner] = await tx.select({ id: clientsTable.id })
    .from(clientsTable)
    .where(and(
      eq(clientsTable.tenantId, input.tenantId),
      eq(clientsTable.referralCode, input.code),
      eq(clientsTable.referralCodeStatus, "active"),
    ))
    .limit(1);
  if (!owner) throw new ValidationError("Código de indicação inválido ou bloqueado", "INVALID_REFERRAL_CODE");

  // Serialize visits to the same code, including distinct cookies. The summary
  // read below must see every committed append before updating CRM rows.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.tenantId + ":" + input.code}, 0))`);
  let cookieId = input.serverCookieId;
  let existingRecord: {
    pagesVisited: unknown;
    referralCode: string;
  } | undefined;

  if (cookieId) {
    const [found] = await tx.select({
      pagesVisited: referralTrackingTable.pagesVisited,
      referralCode: referralTrackingTable.referralCode,
    })
      .from(referralTrackingTable)
      .where(and(
        eq(referralTrackingTable.tenantId, input.tenantId),
        eq(referralTrackingTable.cookieId, cookieId),
      ))
      .limit(1);

    if (found && found.referralCode === input.code) {
      existingRecord = found;
    } else {
      cookieId = undefined;
    }
  }

  if (!cookieId) cookieId = generateCookieId();

  if (existingRecord) {
    await tx.update(referralTrackingTable)
      .set({
        lastVisit: now,
        visitsCount: sql`visits_count + 1`,
        ...(input.landingPage ? {
          pagesVisited: sql`COALESCE(${referralTrackingTable.pagesVisited}::jsonb, '[]'::jsonb) || ${JSON.stringify([input.landingPage])}::jsonb`,
        } : {}),
        updatedAt: now,
      })
      .where(and(
        eq(referralTrackingTable.tenantId, input.tenantId),
        eq(referralTrackingTable.cookieId, cookieId),
      ));
  } else {
    await tx.insert(referralTrackingTable).values({
      id: generateId(),
      tenantId: input.tenantId,
      cookieId,
      referralCode: input.code,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      deviceType: detectDeviceType(input.userAgent),
      browser: detectBrowser(input.userAgent),
      os: detectOS(input.userAgent),
      pagesVisited: input.landingPage ? [input.landingPage] : [],
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      utmContent: input.utmContent,
      utmTerm: input.utmTerm,
    });
  }

  const syncCode = existingRecord?.referralCode ?? input.code;
  const [summary] = await tx.select({
    visitsCount: sql<number>`COALESCE(SUM(${referralTrackingTable.visitsCount}), 0)`,
    firstVisit: sql<Date | null>`MIN(${referralTrackingTable.firstVisit})`,
    lastVisit: sql<Date | null>`MAX(${referralTrackingTable.lastVisit})`,
  })
    .from(referralTrackingTable)
    .where(and(
      eq(referralTrackingTable.tenantId, input.tenantId),
      eq(referralTrackingTable.referralCode, syncCode),
    ));

  const visitsCount = Number(summary?.visitsCount ?? 0);
  await tx.update(referralsTable)
    .set({
      visitsCount,
      firstVisit: summary?.firstVisit ? new Date(summary.firstVisit) : now,
      lastVisit: summary?.lastVisit ? new Date(summary.lastVisit) : now,
      updatedAt: now,
    })
    .where(and(
      eq(referralsTable.tenantId, input.tenantId),
      eq(referralsTable.code, syncCode),
    ));

  return {
    cookieId,
    referralCode: syncCode,
    firstVisit: !existingRecord,
    visitsCount,
  };
}