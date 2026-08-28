let appPromise;

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

async function getApp() {
  appPromise ??= import("./bundle.mjs").then((module) => module.default);
  return appPromise;
}

export default async function handler(request, response) {
  try {
    const app = await getApp();
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
