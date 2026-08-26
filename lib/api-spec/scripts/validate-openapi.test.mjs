import assert from "node:assert/strict";
import test from "node:test";

import {
  findTopLevelOpenApiDocuments,
  validateOpenApiSource,
} from "./validate-openapi.mjs";

test("accepts one top-level OpenAPI document", () => {
  const source = "openapi: 3.1.0\ninfo:\n  title: Example\n";

  assert.deepEqual(findTopLevelOpenApiDocuments(source), [
    { line: 1, column: 1 },
  ]);
  assert.deepEqual(validateOpenApiSource(source, "fixture/openapi.yaml"), {
    line: 1,
    column: 1,
  });
});

test("rejects a duplicate root document marker with both locations", () => {
  const source = [
    "openapi: 3.1.0",
    "info:",
    "  title: First",
    "openapi: 3.1.0",
    "info:",
    "  title: Second",
  ].join("\n");

  assert.throws(() => validateOpenApiSource(source, "fixture/openapi.yaml"), {
    message:
      "OpenAPI contract contains 2 top-level documents. " +
      "The first document starts at fixture/openapi.yaml:1:1; " +
      "duplicate document marker(s) found at fixture/openapi.yaml:4:1.",
  });
});

test("rejects a second YAML document marker", () => {
  const source = [
    "openapi: 3.1.0",
    "info:",
    "  title: First",
    "---",
    "openapi: 3.1.0",
    "info:",
    "  title: Second",
  ].join("\n");

  assert.equal(findTopLevelOpenApiDocuments(source).length, 2);
  assert.throws(
    () => validateOpenApiSource(source, "fixture/openapi.yaml"),
    /duplicate document marker\(s\) found at fixture\/openapi\.yaml:5:1/,
  );
});
