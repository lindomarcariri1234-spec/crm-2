---
name: Marketing NPS naming conflict
description: Existing npsResponsesTable in marketing.ts is for e-commerce; client travel NPS uses a different name.
---

The `npsResponsesTable` exported from `lib/db/src/schema/marketing.ts` maps to the `nps_responses` table and is used for marketing/e-commerce NPS flows (fields: `userId`, `orderId`, `score`, `classification`, `feedback`).

A separate table was added for post-trip travel NPS:
- Export name: `clientNpsResponsesTable`
- Table name: `client_nps_responses`
- Schema file: `lib/db/src/schema/nps.ts`
- Fields: `id`, `tenantId`, `clientId`, `reservationId`, `tripId`, `score`, `comment`, `createdAt`
- Unique constraint on `reservationId` (one NPS per reservation)

**Why:** The two use cases are completely different — marketing NPS is order-based and links to a userId, while travel NPS is reservation-based and links to a clientId. Using the same table name would cause ambiguous import errors across the entire build.

**How to apply:** When writing code that references travel/reservation NPS, always import `clientNpsResponsesTable`, never `npsResponsesTable`.
