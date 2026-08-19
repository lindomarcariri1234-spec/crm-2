---
name: Store product vs trip favorites DB join
description: How to query client_favorites and join back to product/trip data for the GET /favorites endpoint
---

**Table**: `client_favorites` — columns: id, tenantId, clientId, itemType ('trip'|'product'), itemId, createdAt.

**For trip favorites** (itemType = 'trip', itemId = tripsTable.id):
Join path: `client_favorites → storeProductsTable (ON storeProductsTable.tripId = itemId) → storesTable (ON storesTable.id = storeId AND storesTable.tenantId = me.tenantId)`.

**For product favorites** (itemType = 'product', itemId = storeProductsTable.id):
Join path: `client_favorites → storeProductsTable (ON storeProductsTable.id = itemId) → storesTable (ON storesTable.id = storeId AND storesTable.tenantId = me.tenantId)`.

**Why two-step join**: storeProductsTable has no tenantId column; the tenantId filter comes through storesTable. Always include the storesTable join to avoid cross-tenant data leaks.

**How to apply**: See `artifacts/api-server/src/routes/client-portal.ts` GET /client/me/favorites for the reference implementation.
