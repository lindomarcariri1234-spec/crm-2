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
  const patched = async (
    url: string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const urlStr = typeof url === "string" ? url : url.toString();

    if (
      urlStr.includes(".ingest.uploadthing.com") &&
      (!init?.method || init.method.toUpperCase() === "PUT")
    ) {
      // Fix 1: Un-double-encode query params.
      // Effect-Platform encodes % → %25, turning %2F into %252F.
      const fixedUrl = urlStr.replace(/%25([0-9A-Fa-f]{2})/g, "%$1");

      // Fix 2: Strip the spurious `Range: bytes=0-` header.
      const headers = new Headers(init?.headers);
      headers.delete("range");

      return original(fixedUrl, { ...init, headers });
    }

    return original(url, init);
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
