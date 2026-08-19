/**
 * Guards against the "missing zod import" bug class.
 *
 * A route handler can reference the zod `z` helper (e.g. `z.object({...})`)
 * without a matching `import { z } from "zod"` at the top of the file. TypeScript
 * flags it, but the production esbuild bundle can paper over it depending on
 * hoisting, and a vitest run only surfaces it as a silent 500 if (and only if)
 * the specific code path that touches `z` is exercised by a test. This actually
 * happened: `clients.ts` shipped a `z.*` reference with no import, producing a
 * silent runtime failure that no static check caught.
 *
 * This test statically scans every file under `src/routes/`. If a file uses the
 * `z` identifier as a value (`z.<something>`) but does not import it from "zod"
 * (or "zod/v4"), the test fails fast with the offending file names — before the
 * code can reach production.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = resolve(here, "..", "routes");

/**
 * Matches a use of `z` as an identifier followed by a property access, e.g.
 * `z.object`, `z.string`. The negative lookbehind `(?<![\w$.])` excludes:
 *  - identifiers that merely end in `z` (e.g. `xyz.foo`), and
 *  - property accesses on some other object (e.g. `obj.z.bar`),
 * so only genuine references to the bare `z` binding are flagged.
 */
const Z_USAGE = /(?<![\w$.])z\./;

/**
 * Matches a zod import that brings `z` into scope, covering both
 * `import { z } from "zod"` / `"zod/v4"` and `import * as z from "zod"`.
 * The `from "zod"` prefix match intentionally also accepts subpaths like
 * `"zod/v4"`.
 */
const Z_IMPORT = /import\s+(?:\*\s+as\s+z|\{[^}]*\bz\b[^}]*\})\s+from\s+["']zod/;

function listRouteFiles(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort();
}

describe("route files: zod import guard", () => {
  it("finds at least one route file (sanity check the scan path)", () => {
    expect(listRouteFiles().length).toBeGreaterThan(0);
  });

  it("every route file that uses `z.` imports `z` from zod", () => {
    const offenders: string[] = [];

    for (const file of listRouteFiles()) {
      const source = readFileSync(join(ROUTES_DIR, file), "utf8");
      if (Z_USAGE.test(source) && !Z_IMPORT.test(source)) {
        offenders.push(file);
      }
    }

    expect(
      offenders,
      `These route files reference \`z.\` but never import it from "zod" ` +
        `(add \`import { z } from "zod";\`): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
