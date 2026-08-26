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
  return source.split(/\r?\n/).flatMap((line, index) => {
    if (!/^(?:\uFEFF)?(?:['"]?openapi['"]?)\s*:/.test(line)) {
      return [];
    }

    return [{ line: index + 1, column: line.search(/\S/) + 1 }];
  });
}

/**
 * Finds operation IDs and their path/method locations from the source YAML.
 * Keeping the source locations instead of only parsing the resulting object
 * makes validation errors actionable and avoids adding a parser dependency to
 * this lightweight pre-codegen check.
 */
export function findOpenApiOperations(source) {
  const lines = source.split(/\r?\n/);
  const operations = [];
  let inPaths = false;
  let currentPath;
  let currentMethod;

  for (const [index, line] of lines.entries()) {
    if (/^paths:\s*(?:#.*)?$/.test(line)) {
      inPaths = true;
      currentPath = undefined;
      currentMethod = undefined;
      continue;
    }

    if (!inPaths) {
      continue;
    }

    if (/^\S/.test(line) && line.trim() && !line.startsWith("#")) {
      inPaths = false;
      continue;
    }

    const pathMatch = line.match(/^ {2}(\/[^:]+):(?:\s*#.*)?$/);
    if (pathMatch) {
      currentPath = pathMatch[1].trim();
      currentMethod = undefined;
      continue;
    }

    const methodMatch = line.match(
      /^ {4}(get|put|post|delete|options|head|patch|trace):(?:\s*#.*)?$/i,
    );
    if (methodMatch) {
      currentMethod = methodMatch[1].toUpperCase();
      continue;
    }

    const operationIdMatch = line.match(
      /^ {6}operationId\s*:\s*(?:"((?:\\.|[^"])*)"|'([^']*)'|([^#\s]+))/,
    );
    if (!operationIdMatch || !currentPath || !currentMethod) {
      continue;
    }

    operations.push({
      operationId:
        operationIdMatch[1] ?? operationIdMatch[2] ?? operationIdMatch[3],
      path: currentPath,
      method: currentMethod,
      line: index + 1,
      column: line.indexOf("operationId") + 1,
    });
  }

  return operations;
}

export function findDuplicateOpenApiOperations(source) {
  const operationsById = new Map();

  for (const operation of findOpenApiOperations(source)) {
    const operations = operationsById.get(operation.operationId) ?? [];
    operations.push(operation);
    operationsById.set(operation.operationId, operations);
  }

  return [...operationsById.entries()]
    .filter(([, operations]) => operations.length > 1)
    .map(([operationId, operations]) => ({ operationId, operations }));
}

export function validateUniqueOpenApiOperationIds(
  source,
  filePath = sourcePath,
) {
  const duplicates = findDuplicateOpenApiOperations(source);

  if (duplicates.length > 0) {
    const details = duplicates
      .map(({ operationId, operations }) => {
        const locations = operations
          .map(
            (operation) =>
              `${operation.method} ${operation.path} at ${filePath}:${operation.line}:${operation.column}`,
          )
          .join("; ");
        return `  ${operationId}: ${locations}`;
      })
      .join("\n");

    throw new Error(
      `OpenAPI contract contains duplicate operationId values:\n${details}`,
    );
  }

  return true;
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

  validateUniqueOpenApiOperationIds(source, filePath);

  return documents[0];
}

async function main() {
  const source = await readFile(sourcePath, "utf8");
  validateOpenApiSource(source);
  console.log(`OpenAPI contract validation passed: ${sourcePath}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
