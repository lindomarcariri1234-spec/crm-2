// Safety limits for endpoints that currently return full result sets to the
// client without pagination. These caps protect the API against unbounded
// memory/CPU use on pathologically large tenants while keeping the existing
// response shapes (plain arrays) intact, so the frontend keeps working as-is.
//
// Realistic data volumes for the affected reference/list tables are far below
// these caps; they only guard against runaway result sets.

// Max rows returned by uncapped list endpoints (registrations, communication,
// admin user/tenant listings). Ordered by most-recent first at the call site,
// so the cap keeps the freshest records.
export const LIST_SAFETY_CAP = 1000;

// Report export bounds (synchronous PDF/Excel/CSV generation). A direct
// download must stay bounded so it never blocks the event loop for other
// users. The date range is capped and the primary dataset is row-bounded;
// exceeding either returns HTTP 400 asking the user to narrow the range
// (truncating would silently corrupt financial totals).
export const MAX_REPORT_RANGE_DAYS = 366;
export const MAX_EXPORT_ROWS = 10000;
