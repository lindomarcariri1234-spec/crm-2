/**
 * Storefront reservations are leads first, regardless of whether the
 * customer paid a deposit during checkout. Payment lifecycle handlers move
 * the same reservation-linked deal forward after confirmation.
 */
export const STOREFRONT_INITIAL_PIPELINE_STAGE = "Vitrine" as const;

export function getStorefrontInitialPipelineStage(_isDepositConfirmed: boolean) {
  return STOREFRONT_INITIAL_PIPELINE_STAGE;
}