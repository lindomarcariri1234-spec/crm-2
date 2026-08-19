import { db } from "@workspace/db";
import {
  storeCouponsTable,
  storeOrdersTable,
  clientsTable,
  referralSettingsTable,
  tenantsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { AppError, ValidationError } from "../../lib/errors";
import { roundMoney } from "../../lib/pricing";

export interface ResolvedDiscounts {
  discountAmount: number;
  couponId?: string;
  appliedReferralCode?: string;
  appliedReferralReferrerId?: string;
  appliedReferralDiscountValue: number;
  appliedReferralDiscountType: string;
}

export interface ResolveDiscountsArgs {
  storeId: string;
  tenantId: string;
  subtotal: number;
  couponCode?: string;
  referralCode?: string;
  customerEmail: string;
}

export async function resolveCheckoutDiscounts(
  args: ResolveDiscountsArgs,
): Promise<ResolvedDiscounts> {
  const { storeId, tenantId, subtotal, couponCode, referralCode, customerEmail } = args;

  let discountAmount = 0;
  let couponId: string | undefined;
  let appliedReferralCode: string | undefined;
  let appliedReferralReferrerId: string | undefined;
  let appliedReferralDiscountValue = 5;
  let appliedReferralDiscountType = "percentage";

  let couponsEnabled = true;
  let referralsEnabled = true;
  if (couponCode || referralCode) {
    const [tenantRow] = await db
      .select({ settings: tenantsTable.settings })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    const tenantSettings = (tenantRow?.settings ?? {}) as Record<string, unknown>;
    couponsEnabled = tenantSettings.couponsEnabled !== false;
    referralsEnabled = tenantSettings.referralsEnabled !== false;
  }

  if (couponsEnabled && couponCode) {
    const [coupon] = await db.select().from(storeCouponsTable)
      .where(and(
        eq(storeCouponsTable.storeId, storeId),
        eq(storeCouponsTable.code, couponCode),
        eq(storeCouponsTable.isActive, true),
      )).limit(1);
    if (coupon) {
      const now = new Date();
      if (coupon.startsAt > now || coupon.expiresAt < now) {
        throw new ValidationError("Este cupom está expirado", "COUPON_EXPIRED");
      }
      if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
        throw new ValidationError("Este cupom atingiu o limite de uso", "COUPON_USAGE_LIMIT_EXCEEDED");
      }
      if (coupon.type === "percentage") {
        discountAmount = roundMoney(subtotal * (Number(coupon.value) / 100));
      } else if (coupon.type === "fixed") {
        discountAmount = roundMoney(Number(coupon.value));
      }
      if (coupon.maxDiscountAmount) {
        discountAmount = Math.min(discountAmount, roundMoney(Number(coupon.maxDiscountAmount)));
      }
      couponId = coupon.id;
    }
  }

  if (referralsEnabled && referralCode && !couponId) {
    const upperCode = referralCode.toUpperCase();
    const [referrer] = await db.select({
      id: clientsTable.id,
      name: clientsTable.name,
      email: clientsTable.email,
      referralCodeStatus: clientsTable.referralCodeStatus,
      successfulReferrals: clientsTable.successfulReferrals,
    }).from(clientsTable)
      .where(and(
        eq(clientsTable.tenantId, tenantId),
        eq(clientsTable.referralCode, upperCode),
      )).limit(1);

    if (referrer) {
      const [refSettings] = await db.select({
        discountValue: referralSettingsTable.discountValue,
        discountType: referralSettingsTable.discountType,
        isEnabled: referralSettingsTable.isEnabled,
        allowSelfReferral: referralSettingsTable.allowSelfReferral,
        requireFirstPurchase: referralSettingsTable.requireFirstPurchase,
        bonusValue: referralSettingsTable.bonusValue,
        minPurchaseAmount: referralSettingsTable.minPurchaseAmount,
        maxReferralsPerUser: referralSettingsTable.maxReferralsPerUser,
      }).from(referralSettingsTable)
        .where(eq(referralSettingsTable.tenantId, tenantId)).limit(1);

      if (!refSettings || refSettings.isEnabled !== false) {
        let referralEligible = true;

        // Block codes with status blocked/cancelled
        if (referrer.referralCodeStatus && referrer.referralCodeStatus !== "active") {
          referralEligible = false;
        }

        // Enforce minPurchaseAmount
        if (referralEligible && refSettings?.minPurchaseAmount != null) {
          const minAmount = Number(refSettings.minPurchaseAmount);
          if (minAmount > 0 && subtotal < minAmount) {
            throw new AppError(
              `Valor mínimo para indicação: R$ ${minAmount.toFixed(2).replace(".", ",")}`,
              422,
              "REFERRAL_MINIMUM_NOT_MET",
            );
          }
        }

        // Enforce maxReferralsPerUser
        if (referralEligible && refSettings?.maxReferralsPerUser != null) {
          const maxReferrals = Number(refSettings.maxReferralsPerUser);
          if (maxReferrals > 0 && (referrer.successfulReferrals ?? 0) >= maxReferrals) {
            throw new AppError(
              "Este indicador atingiu o limite máximo de indicações",
              422,
              "REFERRAL_CODE_LIMIT_REACHED",
            );
          }
        }

        if (referralEligible && !refSettings?.allowSelfReferral && referrer.email && customerEmail) {
          if (referrer.email.toLowerCase() === customerEmail.toLowerCase()) referralEligible = false;
        }

        if (referralEligible && refSettings?.requireFirstPurchase && customerEmail) {
          const [priorOrder] = await db.select({ id: storeOrdersTable.id })
            .from(storeOrdersTable)
            .where(and(
              eq(storeOrdersTable.tenantId, tenantId),
              eq(storeOrdersTable.customerEmail, customerEmail.toLowerCase()),
              eq(storeOrdersTable.status, "completed"),
            )).limit(1);
          if (priorOrder) referralEligible = false;
        }

        if (referralEligible) {
          const discValue = Number(refSettings?.discountValue ?? "5");
          appliedReferralDiscountType = refSettings?.discountType ?? "percentage";
          if (appliedReferralDiscountType === "fixed") {
            discountAmount = roundMoney(Math.min(discValue, subtotal));
          } else {
            discountAmount = roundMoney(subtotal * (discValue / 100));
          }
          appliedReferralDiscountValue = discValue;
          appliedReferralCode = upperCode;
          appliedReferralReferrerId = referrer.id;
        }
      }
    }
  }

  return {
    discountAmount,
    couponId,
    appliedReferralCode,
    appliedReferralReferrerId,
    appliedReferralDiscountValue,
    appliedReferralDiscountType,
  };
}
