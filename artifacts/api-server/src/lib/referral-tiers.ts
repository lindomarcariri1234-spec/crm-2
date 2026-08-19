export interface ReferralTier {
  level: string;
  label: string;
  minReferrals: number;
  bonusMultiplier: number;
}

export const DEFAULT_TIERS: ReferralTier[] = [
  { level: "bronze",  label: "Bronze",   minReferrals: 0,  bonusMultiplier: 1.0 },
  { level: "silver",  label: "Prata",    minReferrals: 5,  bonusMultiplier: 1.25 },
  { level: "gold",    label: "Ouro",     minReferrals: 15, bonusMultiplier: 1.5 },
  { level: "diamond", label: "Diamante", minReferrals: 30, bonusMultiplier: 2.0 },
];

export interface ComputedTier {
  tier: ReferralTier;
  nextTier: ReferralTier | null;
  progress: number;
}

export function computeReferralTier(
  totalCompleted: number,
  tiersConfig: ReferralTier[] | null | undefined,
): ComputedTier {
  const tiers =
    tiersConfig && tiersConfig.length > 0
      ? [...tiersConfig].sort((a, b) => a.minReferrals - b.minReferrals)
      : DEFAULT_TIERS;

  let currentIdx = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (totalCompleted >= tiers[i].minReferrals) {
      currentIdx = i;
    }
  }

  const tier = tiers[currentIdx];
  const nextTier = tiers[currentIdx + 1] ?? null;

  let progress = 100;
  if (nextTier) {
    const range = nextTier.minReferrals - tier.minReferrals;
    const done = totalCompleted - tier.minReferrals;
    progress = range > 0 ? Math.min(Math.floor((done / range) * 100), 99) : 0;
  }

  return { tier, nextTier, progress };
}
