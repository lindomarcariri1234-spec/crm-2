---
name: Referral tier upgrade email pattern
description: How tier upgrades are detected on referral conversion and emailed to referrers
---

## Rule
`recordReferralConversion` (referral-conversion.ts) now returns `ReferralConversionResult` with `{tierUpgraded, newTierLevel, newTierLabel, bonusMultiplier}`. The caller in `persist-order.ts` checks `referralConversionResult?.tierUpgraded` and calls `dispatchReferralTierUpgradeEmail`.

**Why:** Tier detection must happen inside the transaction (before/after `successfulReferrals` increment) but the email must fire outside to avoid holding the DB transaction open during network I/O.

**How to apply:**
- Template: `lib/email/src/templates/referral-tier-upgrade.tsx`
- Send fn: `sendReferralTierUpgradeEmail` in `lib/email/src/service.ts`
- Dispatch fn: `dispatchReferralTierUpgradeEmail` in `artifacts/api-server/src/queues/email-helpers.ts`
- Detection: compare `computeReferralTier(before)` vs `computeReferralTier(after)` by `.tier.level`

## Referrer tier badge in main referrals list
The tier badge in `indicacoes.tsx` main table uses `(r as EnrichedReferral).referrerSuccessfulReferrals` — this field is joined from `clientsTable.successfulReferrals` in the GET /referrals endpoint. Do NOT use the per-row `conversions` aggregation (that counts conversions visible in the current page/filter, not the referrer's lifetime total).

## Referral reversal email (#28)
When a reservation cancellation reverses a referral (`reversedReferralReferrerId` set in `reservations.ts` PATCH), `dispatchReferralReversedEmail` fires. It sends an inline HTML email (no separate template) via Resend directly.
