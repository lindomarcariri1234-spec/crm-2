import Stripe from "stripe";

async function getCredentials(): Promise<{ publishableKey: string; secretKey: string }> {
  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  const xReplitToken = process.env["REPL_IDENTITY"]
    ? "repl " + process.env["REPL_IDENTITY"]
    : process.env["WEB_REPL_RENEWAL"]
      ? "depl " + process.env["WEB_REPL_RENEWAL"]
      : null;

  if (hostname && xReplitToken) {
    try {
      const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";
      const targetEnvironment = isProduction ? "production" : "development";

      const url = new URL(`https://${hostname}/api/v2/connection`);
      url.searchParams.set("include_secrets", "true");
      url.searchParams.set("connector_names", "stripe");
      url.searchParams.set("environment", targetEnvironment);

      const resp = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "X-Replit-Token": xReplitToken,
        },
        signal: AbortSignal.timeout(5_000),
      });

      if (resp.ok) {
        const data = await resp.json() as {
          items?: Array<{ settings?: { publishable?: string; secret?: string } }>;
        };
        const settings = data.items?.[0]?.settings;
        if (settings?.publishable && settings?.secret) {
          return { publishableKey: settings.publishable, secretKey: settings.secret };
        }
      }
    } catch {
      // Fall through to env vars
    }
  }

  const secretKey = process.env["STRIPE_SECRET_KEY"];
  const publishableKey = process.env["STRIPE_PUBLISHABLE_KEY"] ?? "";
  if (secretKey) {
    return { publishableKey, secretKey };
  }

  throw new Error(
    "Stripe não configurado. Conecte o Stripe via Integrações Replit ou defina STRIPE_SECRET_KEY."
  );
}

export async function getStripePublishableKey(): Promise<string> {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey, {
    apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion,
  });
}
