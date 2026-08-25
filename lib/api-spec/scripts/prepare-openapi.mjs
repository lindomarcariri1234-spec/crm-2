import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiSpecDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(apiSpecDir, "openapi.yaml");
const generatedPath = path.join(apiSpecDir, ".openapi.codegen.yaml");
const source = await readFile(sourcePath, "utf8");
const documentStarts = [...source.matchAll(/^openapi:\s*3\.1\.0\s*$/gm)];

if (documentStarts.length === 0) {
  throw new Error("openapi.yaml does not contain an OpenAPI 3.1 document.");
}

// The source historically has an accidentally appended, stale second document.
// The first document is the maintained contract. Keep generation deterministic
// while allowing the checked-in source to be consolidated independently.
const canonicalSource = source.slice(
  documentStarts[0].index,
  documentStarts[1]?.index,
);

await writeFile(generatedPath, canonicalSource);