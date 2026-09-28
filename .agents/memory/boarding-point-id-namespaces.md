---
name: Boarding point ID namespaces
description: Distinguishes trip-specific boarding point IDs from agency catalog location IDs stored on reservations.
---

Trip-specific boarding points have their own IDs. A point sourced from the agency catalog may also carry a catalog `boardingLocationId`. Storefront checkout saves the trip-point ID in `reservation.boardingLocationId`; older and CRM-created reservations can save catalog IDs. Reservation reads resolve against trip points first, then the agency catalog.

**Why:** The reservation field name suggests one ID system, but it can contain values from two namespaces. Treating every value as a catalog ID makes a valid storefront selection appear empty and can overwrite it during edits.

**How to apply:** When reading or editing reservation boarding, match the saved ID as-is, include both trip-specific and catalog options, and retain a saved value when its source record is no longer available. For new reservations, clear the selected point when the trip changes because that point belongs to the previous trip.

**Freshness rule:** The new-reservation wizard has its own trip-detail cache key. Successful trip edits must invalidate that key, and an open wizard should refetch periodically to receive changes from other sessions. If fresh data removes the selected trip point, clear the unsaved selection instead of submitting the stale ID.

**Why:** React Query invalidation is local to a browser client, so it cannot update another user's already-open wizard. A cached point can otherwise keep showing old details or leave an ID that no longer exists.

**How to apply:** Keep the trip editor's invalidation key aligned with the wizard and limit periodic refetching to the open wizard. Test refreshed point metadata and point removal.