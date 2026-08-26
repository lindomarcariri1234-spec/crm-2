import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(new URL("../openapi.yaml", import.meta.url));

/**
 * Finds top-level OpenAPI document markers without parsing generated YAML.
 * A second root-level `openapi:` is either a duplicate mapping or an appended
 * YAML document; both cases are unsafe for code generation.
 */
export function findTopLevelOpenApiDocuments(source) {
  return source
    .split(/\r?\n/)
    .flatMap((line, index) => {
      if (!/^(?:\uFEFF)?(?:['"]?openapi['"]?)\s*:/.test(line)) {
        return [];
      }

      return [{ line: index + 1, column: line.search(/\S/) + 1 }];
    });
}

export function validateOpenApiSource(source, filePath = sourcePath) {
  const documents = findTopLevelOpenApiDocuments(source);

  if (documents.length === 0) {
    throw new Error(
      `OpenAPI contract has no top-level document marker in ${filePath}. ` +
        "Expected one root-level `openapi:` key.",
    );
  }

  if (documents.length > 1) {
    const [first, ...duplicates] = documents;
    const duplicateLocations = duplicates
      .map((location) => `${filePath}:${location.line}:${location.column}`)
      .join(", ");

    throw new Error(
      `OpenAPI contract contains ${documents.length} top-level documents. ` +
        `The first document starts at ${filePath}:${first.line}:${first.column}; ` +
        `duplicate document marker(s) found at ${duplicateLocations}.`,
    );
  }

  return documents[0];
}

async function main() {
  const source = await readFile(sourcePath, "utf8");
  validateOpenApiSource(source);
  console.log(`OpenAPI contract validation passed: ${sourcePath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}