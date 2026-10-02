---
name: Trip occupancy and cost reconciliation
description: Keep trip occupancy projections and confirmed-booking cost budgets on distinct bases.
---

For trip planning, fixed costs remain constant regardless of passenger count; per-passenger variable costs scale with estimated paying passengers. Generate 50%, 60%, 70%, 80%, 90% and 100% occupancy scenarios, using whole passengers and rounding fractional counts down. Keep revenue, variable costs, total operating costs, average cost per passenger, estimated profit and margin tied to that same passenger count. Use 80% as the base scenario. If no passenger-category mix is configured, disclose that projections use the adult fare for every paying passenger.

What-if scenario assumptions must stay local to the screen. Initialize them from saved fares and planned costs, offer a reset to those saved values, and never persist scenario edits into trip prices, costs, or historical financial records.

For trip-cost reconciliation, calculate the planned budget from fixed cost items plus per-passenger variable costs multiplied by confirmed reservation capacity. Label this passenger basis; do not substitute an occupancy-scenario estimate. Keep booked value, recorded trip costs, and cash/payment status distinct.

**Why:** Occupancy scenarios are planning estimates, while the trip-cost screen reconciles its budget against current confirmed bookings and recorded costs. Mixing these bases can make an apparent variance misleading.

**How to apply:** Keep scenario inputs as local state and reset them from saved values. Use the six scenarios in trip planning. In actual trip-cost reconciliation, use confirmed passenger capacity for the planned budget and keep the projection separate from recorded costs and payment-ledger values.