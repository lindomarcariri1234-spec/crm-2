export function isApiRootRequest(request) {
  const url = new URL(request.url || "/api", "http://vercel.internal");
  const rewrittenPath = url.searchParams.get("__vercel_api_path");

  if (rewrittenPath !== null) {
    const normalizedRewrittenPath = rewrittenPath.replace(/^\/+|\/+$/g, "");
    return normalizedRewrittenPath === "";
  }

  const normalizedPath = url.pathname.replace(/\/+$/g, "") || "/";
  return normalizedPath === "/" || normalizedPath === "/api";
}

export function restoreRewrittenApiPath(request) {
  const url = new URL(request.url || "/api", "http://vercel.internal");
  const path = url.searchParams.get("__vercel_api_path");
  if (path === null) return;
  url.searchParams.delete("__vercel_api_path");
  const search = url.searchParams.toString();
  const isStorefrontPath = path === "loja" || path.startsWith("loja/");
  request.url = `${isStorefrontPath ? "" : "/api/"}${path}${search ? `?${search}` : ""}`;
}

export function sendApiRootNotFound(response) {
  response.statusCode = 404;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ error: "NOT_FOUND" }));
}
