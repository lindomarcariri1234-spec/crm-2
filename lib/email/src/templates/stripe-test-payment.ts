export type StripePaymentMode = {
  paymentProvider?: string | null
  stripeLivemode?: boolean | null
}

/** Unknown mode is deliberately not treated as either test or live. */
export function isStripeTestPaymentMode(mode: StripePaymentMode | null | undefined): boolean {
  return mode?.paymentProvider === "stripe" && mode.stripeLivemode === false
}
