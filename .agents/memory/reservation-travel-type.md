---
name: Reservation travel type
description: Keep the CRM travel classification separate from operational reservation type and client preference.
---

The CRM form's `travelType` is a per-reservation classification. Keep it in its own reservation field; do not reuse `reservations.tripType`, which affects reservation-number prefixes, or `clients.travelPreference`, which describes a general client preference.

**Why:** The user chose per-reservation storage, and the existing fields have distinct meanings that must not be conflated.

**How to apply:** Include the dedicated field in reservation create/update flows. Preserve `tripType` for operational code generation and `travelPreference` for the client's general preferences.
