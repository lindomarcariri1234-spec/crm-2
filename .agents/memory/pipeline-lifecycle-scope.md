---
name: Pipeline lifecycle scope
description: Guardrails for synchronizing reservations, payments, and trips with sales-pipeline cards.
---

Pipeline lifecycle synchronization must create new reservation cards in the tenant's default active pipeline (with a deterministic active-pipeline fallback) and scope each open card to its client plus its specific trip. A manual lead without a trip may be adopted by the first reservation; a card attached to another trip must never be reused.

**Why:** Lifecycle stages share names across custom pipelines, and a client can hold reservations on multiple trips. Tenant-wide stage lookups or client-only fallbacks can put a card in the wrong board or advance/cancel the wrong trip. Cancelling one trip also does not invalidate another pending or confirmed trip for the client.

**How to apply:** Resolve stage names within the card's current pipeline for existing cards, and within the canonical pipeline for new cards. Reservation-payment transitions require a reservation link. On cancellation, re-link only to a surviving reservation on the same trip; if any pending/confirmed reservation exists on another trip for that client, keep the deal open in its current stage without re-linking across trips. Move it to "Cancelado" only when no client-wide active reservation remains.

Paid or completed product-only store orders remain visible through their own stable, won “Pedido Loja” card in the canonical pipeline; they must not be treated as reservation lifecycle cards.

Deal stages represent the trip-level journey, not an individual passenger event: “Em Viagem” is based on scheduled departure, and “Pós Viagem” requires an elapsed returnDate. A single passenger boarding/check-in is not evidence that the trip has ended.

**Why:** A reservation card can include multiple passengers, so one person's boarding does not mean the whole booking or trip has reached its post-trip phase.

**How to apply:** Keep automatic stage changes tied to trip dates and the exact linked reservation. If the return date is missing, do not infer completion from passenger check-in; require a separate explicit signal or manual correction.