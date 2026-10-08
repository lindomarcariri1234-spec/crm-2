export const STRIPE_STORE_PAYMENT_METHODS = [
  "credit_card",
  "debit_card",
  "pix",
  "boleto",
] as const;

export type StripeCredentialMode = "test" | "live";
export type StripeCredentialField = "publishableKey" | "secretKey" | "webhookSecret";

export interface StripeCredentialIssue {
  field: StripeCredentialField;
  message: string;
}

interface ValidateStripeStoreConfigInput {
  enabled: boolean;
  paymentMethods: string[];
  publishableKey?: string | null;
  secretKey?: string | null;
  secretKeyConfigured: boolean;
  webhookSecret?: string | null;
  previousPublishableKey?: string | null;
}

export function isStripeSupportedPaymentMethod(method: string): boolean {
  return STRIPE_STORE_PAYMENT_METHODS.includes(
    method as (typeof STRIPE_STORE_PAYMENT_METHODS)[number],
  );
}

export function getStripeCredentialMode(
  key: string | null | undefined,
): StripeCredentialMode | null {
  const match = /^(?:pk|sk|rk)_(test|live)_/.exec(key?.trim() ?? "");
  return (match?.[1] as StripeCredentialMode | undefined) ?? null;
}

export function validateStripeStoreConfig(
  input: ValidateStripeStoreConfigInput,
): StripeCredentialIssue[] {
  if (
    !input.enabled
    || !input.paymentMethods.some(isStripeSupportedPaymentMethod)
  ) {
    return [];
  }

  const issues: StripeCredentialIssue[] = [];
  const publishableKey = input.publishableKey?.trim() ?? "";
  const secretKey = input.secretKey?.trim() ?? "";
  const webhookSecret = input.webhookSecret?.trim() ?? "";
  const publishableMode = getStripeCredentialMode(publishableKey);
  const previousPublishableMode = getStripeCredentialMode(input.previousPublishableKey);

  if (!publishableKey) {
    issues.push({
      field: "publishableKey",
      message: "Informe a chave pública do Stripe.",
    });
  } else if (!/^pk_(test|live)_[A-Za-z0-9]+$/.test(publishableKey)) {
    issues.push({
      field: "publishableKey",
      message: "A chave pública deve começar com pk_test_ ou pk_live_.",
    });
  }

  if (!secretKey) {
    if (!input.secretKeyConfigured) {
      issues.push({
        field: "secretKey",
        message: "Informe a chave secreta do Stripe.",
      });
    } else if (
      publishableMode
      && previousPublishableMode
      && publishableMode !== previousPublishableMode
    ) {
      issues.push({
        field: "secretKey",
        message: "Você mudou entre teste e produção. Informe também a chave secreta do mesmo ambiente.",
      });
    }
  } else if (!/^(?:sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secretKey)) {
    issues.push({
      field: "secretKey",
      message: "A chave secreta deve começar com sk_test_, sk_live_, rk_test_ ou rk_live_.",
    });
  } else {
    const secretMode = getStripeCredentialMode(secretKey);
    if (publishableMode && secretMode !== publishableMode) {
      issues.push({
        field: "secretKey",
        message: "A chave pública e a chave secreta precisam ser do mesmo ambiente (teste ou produção).",
      });
    }
  }

  if (webhookSecret && !/^whsec_[A-Za-z0-9+/=_-]+$/.test(webhookSecret)) {
    issues.push({
      field: "webhookSecret",
      message: "O segredo do webhook deve começar com whsec_.",
    });
  }

  return issues;
}
