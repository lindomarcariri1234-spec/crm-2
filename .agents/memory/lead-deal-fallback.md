---
name: Lead deal fallback
description: Contract between client registration and pipeline deal creation
---

Creating a client from the CRM must not silently skip the pipeline deal when the UI has no selected stage. The deal endpoint accepts an optional stage and resolves the tenant's default stage; the OpenAPI contract and generated clients must stay aligned with that runtime behavior.

**Why:** A client can be persisted successfully while the expected lead card is absent if the frontend gates deal creation on a stage loaded asynchronously.

**How to apply:** Always call deal creation for a new client without a reservation, pass an explicit stage when available, and let the API choose the tenant default otherwise. Keep a regression test for the no-stage path.