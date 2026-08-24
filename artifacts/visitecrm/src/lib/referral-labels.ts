export const REFERRAL_REWARD_LABELS = {
  credit: "Cashback",
  cash: "Dinheiro",
} as const;

export function getReferralRewardLabel(type: string | null | undefined): string {
  if (type === "credit") return REFERRAL_REWARD_LABELS.credit;
  if (type === "cash") return REFERRAL_REWARD_LABELS.cash;
  return "Bônus";
}

export function getReferralCampaignRewardLabel(type: string): string {
  if (type === "no_reward") return "Sem Bônus";
  if (type === "fixed_extra") return "Bônus Fixo Extra (+R$)";
  if (type === "fixed_bonus") return "Bônus Fixo (R$)";
  if (type === "percentage_bonus") return "Bônus Percentual (%)";
  if (type === "reduced_bonus") return "Bônus Reduzido";
  if (type === "multiplier") return "Multiplicador (×)";
  return "Bônus";
}