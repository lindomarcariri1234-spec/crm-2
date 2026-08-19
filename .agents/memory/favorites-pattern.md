---
name: Favorites feature pattern
description: How the vitrine favorites system is wired — context placement, auth check, optimistic toggle
---

FavoritesProvider wraps StoreRouter inside CartProvider in `artifacts/visitecrm/src/pages/vitrine/index.tsx`.

**Auth check**: uses `useGetMe()` from `@workspace/api-client-react`; only loads and syncs favorites when `me?.role === "CLIENT"`.

**Optimistic toggle**: `toggleFavorite(itemType, itemId)` updates local Set immediately, then calls API. On error it rolls back and shows toast.

**Non-authenticated UX**: `toggleFavorite` shows a "Faça login para salvar favoritos" toast and returns early — no API call.

**Item type convention**:
- Trip-backed store products → `itemType = "trip"`, `itemId = product.tripId`
- Generic store products → `itemType = "product"`, `itemId = product.id` (storeProductsTable.id)

**Why**: Separating trips from products makes it easy to join back to tripsTable or storeProductsTable in the GET endpoint, and keeps the semantics clean.

**How to apply**: When adding heart buttons to new product surfaces (e.g. product detail page), use `useFavorites()` from `artifacts/visitecrm/src/contexts/FavoritesContext.tsx`. The context is available anywhere inside the Vitrine router.
