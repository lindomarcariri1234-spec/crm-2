---
name: Brazil timezone formatting patterns
description: Canonical patterns for date display and day-window queries in the Brazil-only app (America/Sao_Paulo, UTC-3 fixed, no DST).
---

## Rule

Never use `toLocaleDateString()`, `toLocaleString()`, or `toISOString().slice(0,N)` on the **server** (runs UTC). Always use explicit `timeZone: "America/Sao_Paulo"`.

**Why:** Production server is UTC. `toLocaleDateString("pt-BR")` silently uses UTC, producing wrong dates for Brazilian users (e.g., 10 PM Brazil = next UTC day). Brazil has been UTC-3 year-round since 2019 (no DST).

## How to apply

### Frontend (browser, visitecrm)
`artifacts/visitecrm/src/lib/utils.ts` exports `formatDate`, `formatDateShort`, `formatDateTime` — all use `Intl.DateTimeFormat` with `timeZone: "America/Sao_Paulo"`.
- date-only strings → append `T12:00:00` before parsing (avoids UTC midnight off-by-one)
- Use these everywhere; do NOT add local `toLocaleDateString("pt-BR")` calls.

### Backend — date display in emails/PDFs
Use a local helper pattern (already in reminder.worker.ts):
```ts
function formatDateBRServer(dt: unknown): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(dt instanceof Date ? dt : new Date(dt as string));
}
```

### Backend — "today's date string" 
Use `localToday()` from `@workspace/shared` → returns "YYYY-MM-DD" in BRT.
NOT `new Date().toISOString().slice(0,10)` (UTC).

### Backend — "current month" 
Use `new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7)`
(sv-SE locale = ISO format, safe for `.slice`).

### Backend — day-window DB queries
Use `brazilDayWindow(n)` (already in reminder.worker.ts):
```ts
function brazilDayWindow(daysFromNow: number): { start: Date; end: Date } {
  const todayBR = localToday();
  const baseMs = new Date(todayBR + "T12:00:00Z").getTime();
  const targetDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(baseMs + daysFromNow * 86_400_000));
  const start = new Date(targetDate + "T03:00:00Z"); // Brazil midnight = UTC+3h
  const end   = new Date(start.getTime() + 86_400_000);
  return { start, end };
}
```
NOT `setDate(getDate()+N); setHours(0,0,0,0)` (uses UTC midnight, misses 10 PM–midnight BRT).

### PostgreSQL — timezone-aware comparison
Already done correctly in referral expiry queries: `AT TIME ZONE 'America/Sao_Paulo'`.
Drizzle js-side: pass UTC Date objects from `brazilDayWindow()`.
