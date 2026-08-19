// Minimal ambient declarations for packages that cannot be resolved by
// "moduleResolution: bundler" due to missing/empty exports entries.
// Each declaration exposes only the subset used by this codebase.

// undici – used in src/lib/ssrf.ts.
// The package ships "types": "index.d.ts" at the root but its exports map
// has no typed "." entry, so bundler-mode resolution falls back to globals
// (loading Dispatcher into the global namespace) without resolving the module.
// This ambient declaration provides the module surface used by ssrf.ts.
declare module "undici" {
  export class Agent {
    constructor(options?: {
      connect?: {
        lookup?: (
          hostname: string,
          options: unknown,
          callback: (err: Error | null, address: string, family: number) => void
        ) => void;
      };
    });
  }

  export function fetch(
    input: string | Request | URL,
    init?: RequestInit & { dispatcher?: Agent }
  ): Promise<Response>;
}

// http-proxy-middleware – used in src/middlewares/clerkProxyMiddleware.ts.
declare module "http-proxy-middleware" {
  import type * as http from "node:http";

  export interface Options {
    target?: string;
    changeOrigin?: boolean;
    pathRewrite?:
      | Record<string, string>
      | ((path: string, req: http.IncomingMessage) => string);
    on?: {
      proxyReq?: (
        proxyReq: http.ClientRequest,
        req: http.IncomingMessage,
        res: http.ServerResponse
      ) => void;
      proxyRes?: (
        proxyRes: http.IncomingMessage,
        req: http.IncomingMessage,
        res: http.ServerResponse
      ) => void;
      error?: (
        err: Error,
        req: http.IncomingMessage,
        res: http.ServerResponse
      ) => void;
    };
    [key: string]: unknown;
  }

  export function createProxyMiddleware(
    options: Options
  ): (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    next: (err?: unknown) => void
  ) => void;
}
