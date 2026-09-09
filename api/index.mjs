let appPromise;

// Vercel traces dependencies from this small conventional function file, not
// from bundle.mjs added through includeFiles. Keep literal dynamic imports
// here so the corresponding external packages are copied into the function.
// This function is intentionally never executed: bundle.mjs must apply the
// UploadThing fetch patch before loading uploadthing itself.
function traceExternalDependenciesForVercel() {
  return Promise.all([
    import("exceljs"),
    import("googleapis"),
    import("http-proxy-middleware"),
    import("openai"),
    import("jspdf"),
    import("jspdf-autotable"),
    import("pdfkit"),
    import("stripe"),
    import("stripe-replit-sync"),
    import("uploadthing"),
  ]);
}
void traceExternalDependenciesForVercel;

function getMissingPackage(error) {
  if (!error || typeof error !== "object") return undefined;
  const message = typeof error.message === "string" ? error.message : "";
  const match =
    message.match(/Cannot find package ['"]([^'"]+)['"]/) ??
    message.match(/Cannot find module ['"]([^'"]+)['"]/);
  const packageName = match?.[1];
  return packageName && /^@?[A-Za-z0-9_./-]+$/.test(packageName)
    ? packageName
    : undefined;
}

function restoreRewrittenApiPath(request) {
  const url = new URL(request.url || "/api", "http://vercel.internal");
  const path = url.searchParams.get("__vercel_api_path");
  if (path === null) return;
  url.searchParams.delete("__vercel_api_path");
  const search = url.searchParams.toString();
  request.url = `/api/${path}${search ? `?${search}` : ""}`;
}

async function getApp() {
  appPromise ??= import("./bundle.mjs").then((module) => module.default);
  return appPromise;
}

export default async function handler(request, response) {
  try {
    const app = await getApp();
    restoreRewrittenApiPath(request);
    return app(request, response);
  } catch (error) {
    appPromise = undefined;
    console.error("[vercel] API bundle failed to initialize", error);
    response.statusCode = 500;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify({
        error: "SERVER_INIT_FAILED",
        code:
          error && typeof error === "object" && typeof error.code === "string"
            ? error.code
            : undefined,
        missingPackage: getMissingPackage(error),
      }),
    );
  }
}
