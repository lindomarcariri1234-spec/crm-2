import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiSpecDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiZodIndexPath = path.resolve(apiSpecDir, "..", "api-zod", "src", "index.ts");

// Orval emits generated/api as the complete public surface and also overwrites
// this package index with generated/types. Exporting both creates duplicate
// TypeScript exports, so keep the package's public entry point deterministic.
await writeFile(apiZodIndexPath, 'export * from "./generated/api";\n');