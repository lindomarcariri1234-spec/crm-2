---
name: Idempotency keys must reach persistence
description: Client-generated idempotency keys can be silently dropped between a route DTO and the database insert.
---

A checkout idempotency guarantee is incomplete until the key is verified in the actual database insert, not only in route validation and preflight lookup.

**Why:** TypeScript structural typing can accept a request object with extra fields while an intermediate service type omits them, causing retries to create duplicate orders without any type or build error.

**How to apply:** When adding idempotency to a route, trace the field from request schema through every service argument to the persistence values object, and test the persisted payload or a real duplicate request.