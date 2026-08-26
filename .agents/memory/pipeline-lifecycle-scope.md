---
name: Pipeline lifecycle scope
description: Guardrails for synchronizing reservations, payments, and trips with sales-pipeline cards.
---

Pipeline lifecycle synchronization must create new reservation cards in the tenant's default active pipeline (with a deterministic active-pipeline fallback) and scope each open card to its client plus its specific trip. A manual lead without a trip may be adopted by the first reservation; a card attached to another trip must never be reused.

**Why:** Lifecycle stages share names across custom pipelines, and a client can hold reservations on multiple trips. Tenant-wide stage lookups or client-only fallbacks can put a card in the wrong board or advance/cancel the wrong trip.

**How to apply:** Resolve stage names within the card's current pipeline for existing cards, and within the canonical pipeline for new cards. Reservation-payment transitions require a reservation link; only same-trip active reservations can prevent a cancellation from closing a deal.

Paid or completed product-only store orders remain visible through their own stable, won “Pedido Loja” card in the canonical pipeline; they must not be treated as reservation lifecycle cards.