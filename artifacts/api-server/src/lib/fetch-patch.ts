/**
 * globalThis.fetch patch for UploadThing CDN uploads.
 *
 * This file MUST be imported first in index.ts — before `import app` —
 * so that patchGlobalFetch() runs before any uploadthing module (express or
 * server) is first required. Both entry points share the same internal
 * effect_Layer.succeed(FetchHttpClient.Fetch, fetch) call; once a module is
 * cached by Node, the captured `fetch` value cannot be changed, so the patch
 * must be in place before the first require.
 *
 * See lib/uploadthing.ts for full root-cause explanation.
 */

function patchGlobalFetch(): void {
  const original = globalThis.fetch;
  let signedUrlEncoding: "unknown" | "normalized" | "provider-issued" = "unknown";
  const patched = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    // Effect-Platform may supply a Request implementation from a different
    // realm, so `instanceof Request` alone is not reliable here.
    const request = typeof input === "object" && input !== null && "url" in input
      ? input as Request
      : undefined;
    const urlStr = request?.url ?? (typeof input === "string" ? input : input.toString());
    const method = init?.method ?? request?.method;

    if (
      urlStr.includes(".ingest.uploadthing.com") &&
      (!method || method.toUpperCase() === "PUT")
    ) {
      // Strip the spurious `Range: bytes=0-` header.
      // Effect-Platform passes a Request object, so handling only `init.headers`
      // leaves its Range header untouched and UploadThing rejects the signature.
      const headers = new Headers(init?.headers ?? request?.headers);
      headers.delete("range");
      const normalizedUrl = urlStr.replace(/%25([0-9A-Fa-f]{2})/g, "%$1");

      if (request) {
        // A Request's properties are not enumerable, so `{ ...request }` would
        // silently lose its stream body. Recreate it explicitly before forwarding.
        const forward = (url: string, source: Request) => {
          const body = init?.body ?? source.body;
          return original(url, {
            method,
            headers,
            body,
            cache: init?.cache ?? source.cache,
            credentials: init?.credentials ?? source.credentials,
            integrity: init?.integrity ?? source.integrity,
            keepalive: init?.keepalive ?? source.keepalive,
            mode: init?.mode ?? source.mode,
            redirect: init?.redirect ?? source.redirect,
            referrer: init?.referrer ?? source.referrer,
            referrerPolicy: init?.referrerPolicy ?? source.referrerPolicy,
            signal: init?.signal ?? source.signal,
            // Node requires duplex for a streamed request body.
            duplex: body ? "half" : undefined,
          });
        };

        const retryRequest = signedUrlEncoding === "unknown" && normalizedUrl !== urlStr
          ? request.clone()
          : undefined;
        const firstUrl = signedUrlEncoding === "provider-issued" ? urlStr : normalizedUrl;
        const response = await forward(firstUrl, request);

        // Some UploadThing signing configurations already use the provider-issued
        // encoding. If canonical normalization is rejected, retry that untouched
        // signed URL once and cache the working representation for later uploads.
        if (
          retryRequest &&
          response.status === 400 &&
          (await response.clone().text()).includes("Invalid signature")
        ) {
          signedUrlEncoding = "provider-issued";
          return forward(urlStr, retryRequest);
        }

        if (signedUrlEncoding === "unknown") signedUrlEncoding = "normalized";
        return response;
      }

      const firstUrl = signedUrlEncoding === "provider-issued" ? urlStr : normalizedUrl;
      const response = await original(firstUrl, { ...init, headers });
      // The server SDK currently supplies its FormData upload as a URL + init
      // rather than a Request. FormData is replayable, so it can use the same
      // signature fallback as the Request branch above.
      if (
        signedUrlEncoding === "unknown" &&
        normalizedUrl !== urlStr &&
        init?.body instanceof FormData &&
        response.status === 400 &&
        (await response.clone().text()).includes("Invalid signature")
      ) {
        signedUrlEncoding = "provider-issued";
        return original(urlStr, { ...init, headers });
      }

      if (signedUrlEncoding === "unknown") signedUrlEncoding = "normalized";
      return response;
    }

    return original(input, init);
  };

  // Detectable marker so index.ts can assert the patch ran before uploadthing
  // loaded its FetchHttpClient (which captures globalThis.fetch by value).
  (patched as typeof patched & { _uploadthingPatched: boolean })._uploadthingPatched = true;
  (globalThis as { fetch: typeof fetch }).fetch = patched;
}

patchGlobalFetch();

/**
 * Always true once this module has been evaluated. Import this constant in
 * index.ts and log it at startup to confirm the patch ran before any
 * uploadthing module was loaded.
 */
export const FETCH_PATCH_APPLIED = true;
