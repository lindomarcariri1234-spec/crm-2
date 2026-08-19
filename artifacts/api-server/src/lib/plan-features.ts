const PLAN_TIER: Record<string, number> = {
  starter: 0,
  pro: 1,
  enterprise: 2,
};

interface FeatureRequirement {
  minTier: number;
  label: string;
}

const FEATURE_REQUIREMENTS: Record<string, FeatureRequirement> = {
  referralsEnabled: { minTier: 1, label: "Programa de Indicação" },
  couponsEnabled: { minTier: 0, label: "Cupons de Desconto" },
  seatMap: { minTier: 1, label: "Mapa de Assentos Personalizável" },
};

export function getPlanTier(planId: string): number {
  return PLAN_TIER[planId] ?? 0;
}

export function canEnableFeature(featureKey: string, planId: string): boolean {
  const req = FEATURE_REQUIREMENTS[featureKey];
  if (!req) return true;
  return getPlanTier(planId) >= req.minTier;
}

export function getFeatureRequiredPlanLabel(featureKey: string): string | null {
  const req = FEATURE_REQUIREMENTS[featureKey];
  if (!req || req.minTier === 0) return null;
  const entry = Object.entries(PLAN_TIER).find(([, tier]) => tier === req.minTier);
  if (!entry) return null;
  return entry[0].charAt(0).toUpperCase() + entry[0].slice(1);
}

export function getFeatureLabel(featureKey: string): string {
  return FEATURE_REQUIREMENTS[featureKey]?.label ?? featureKey;
}

export function hasSeatMapFeature(supportedFeatures: string[]): boolean {
  return supportedFeatures.includes("seatMap");
}
