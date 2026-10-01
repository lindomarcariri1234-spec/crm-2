const baseUrlValue = process.env.VERCEL_SMOKE_BASE_URL;

if (!baseUrlValue) {
  throw new Error("Set VERCEL_SMOKE_BASE_URL to a Vercel preview or production URL");
}

const baseUrl = new URL(baseUrlValue);
if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
  throw new Error("VERCEL_SMOKE_BASE_URL must use HTTP or HTTPS");
}

async function getJson(path) {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const responseText = await response.text();
  let body;
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new Error(
      `GET ${path} returned non-JSON HTTP ${response.status}: ${responseText.slice(0, 300)}`,
    );
  }
  return { status: response.status, body };
}

const [rootApi, health] = await Promise.all([
  getJson("/api"),
  getJson("/api/health"),
]);

if (rootApi.status !== 200 || rootApi.body?.status !== "ok") {
  throw new Error(
    `GET /api must reach the backend and return {status:"ok"}; got HTTP ${rootApi.status}: ${JSON.stringify(rootApi.body)}`,
  );
}

if (
  health.status !== 200 ||
  !["ok", "degraded"].includes(health.body?.status)
) {
  throw new Error(
    `GET /api/health must return HTTP 200 with an API health response; got HTTP ${health.status}: ${JSON.stringify(health.body)}`,
  );
}

console.log(`[smoke-vercel-routes] GET /api → ${rootApi.status} {status:ok}`);
console.log(`[smoke-vercel-routes] GET /api/health → ${health.status} {status:${health.body.status}}`);