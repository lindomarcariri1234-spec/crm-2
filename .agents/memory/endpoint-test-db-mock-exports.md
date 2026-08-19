---
name: endpoint-test-db-mock-exports
description: api-server endpoints.test.ts — vi.mock("@workspace/db") must export every table a handler touches, or the handler throws (500) instead of reaching its guards.
---

# endpoints.test.ts @workspace/db mock must export every referenced table

In `artifacts/api-server/src/__tests__/endpoints.test.ts`, `@workspace/db` is
fully mocked with a hand-listed set of table exports (e.g. `reservationsTable: {}`,
`clientsTable: {}`). If a handler under test references a table that is NOT in that
list, vitest throws `No "<table>" export is defined on the "@workspace/db" mock`
at the line that reads the table. The route's catch/errorHandler turns that into a
generic **500 INTERNAL_ERROR**, which masquerades as a logic bug.

**Why:** a 403/400 negative test passes because the role/validation guard short-
circuits *before* the table is referenced; a positive control that drives the
handler *past* the guard suddenly 500s on the missing export. Confusing because the
status code gives no hint about the real cause.

**How to apply:**
- When adding an endpoint test that exercises a *new* code path (esp. a positive
  control that reaches DB reads), add any newly-referenced table to the db mock's
  export object.
- To surface the real error fast, temporarily flip the stub request logger from
  `pino({ level: "silent" })` to `pino({ level: "error" })` — the errorHandler
  logs the underlying error via `req.log?.error`.
