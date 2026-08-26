import assert from "node:assert/strict";
import test from "node:test";

import {
  findDuplicateOpenApiOperations,
  findOpenApiOperations,
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

test("finds operation IDs with their path, method, and source location", () => {
  const source = [
    "openapi: 3.1.0",
    "paths:",
    "  /trips:",
    "    get:",
    "      operationId: listTrips",
    "    post:",
    "      operationId: createTrip",
  ].join("\n");

  assert.deepEqual(findOpenApiOperations(source), [
    {
      operationId: "listTrips",
      path: "/trips",
      method: "GET",
      line: 5,
      column: 7,
    },
    {
      operationId: "createTrip",
      path: "/trips",
      method: "POST",
      line: 7,
      column: 7,
    },
  ]);
});

test("rejects duplicate operation IDs across paths and methods", () => {
  const source = [
    "openapi: 3.1.0",
    "paths:",
    "  /trips:",
    "    get:",
    "      operationId: listTrips",
    "    post:",
    "      operationId: createTrip",
    "  /trips/{id}:",
    "    get:",
    "      operationId: listTrips",
  ].join("\n");

  assert.deepEqual(findDuplicateOpenApiOperations(source), [
    {
      operationId: "listTrips",
      operations: [
        {
          operationId: "listTrips",
          path: "/trips",
          method: "GET",
          line: 5,
          column: 7,
        },
        {
          operationId: "listTrips",
          path: "/trips/{id}",
          method: "GET",
          line: 10,
          column: 7,
        },
      ],
    },
  ]);

  assert.throws(
    () => validateOpenApiSource(source, "lib/api-spec/openapi.yaml"),
    {
      message:
        "OpenAPI contract contains duplicate operationId values:\n" +
        "  listTrips: GET /trips at lib/api-spec/openapi.yaml:5:7; " +
        "GET /trips/{id} at lib/api-spec/openapi.yaml:10:7",
    },
  );
});

test("rejects duplicate operation IDs on methods of the same path", () => {
  const source = [
    "openapi: 3.1.0",
    "paths:",
    "  /trips:",
    "    get:",
    "      operationId: tripOperation",
    "    post:",
    "      operationId: tripOperation",
  ].join("\n");

  assert.throws(
    () => validateOpenApiSource(source, "fixture/openapi.yaml"),
    /tripOperation: GET \/trips at fixture\/openapi\.yaml:5:7; POST \/trips at fixture\/openapi\.yaml:7:7/,
  );
});
