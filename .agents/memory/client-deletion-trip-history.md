---
name: Client deletion and trip history
description: Deleting a client account must anonymize reservation ownership without removing operational trip history.
---

# Client deletion preserves trip operations

When an agency removes a client account, clear the client identity from that
agency's reservations, but keep the reservation, passengers, assigned seats,
payments, and historical financial records. The reservation may therefore render
as an anonymous/unknown client while the seat and passenger data remain usable.

**Why:** deleting the account must not erase operational or legally relevant
travel history, while the deleted identity must no longer remain linked to trips.

**How to apply:** perform the unlink inside the same transaction as the account
removal, scope it by tenant and client ID, and keep the operation idempotent.