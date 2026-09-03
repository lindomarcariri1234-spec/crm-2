---
name: Calendar dedup not-found pattern
description: How the calendar sync handles events deleted externally in Google Calendar.
---

# Calendar dedup: not-found return value

**Rule:** `GoogleCalendarService.updateEvent()` returns `boolean | "not-found"`.
- `true` = patch succeeded
- `false` = permanent failure (auth, invalid data)
- `"not-found"` = HTTP 404, event was deleted externally in Google

**Why:** If a Google Calendar event is deleted by the user externally, the DB still holds the `googleEventId`. On the next sync, `updateEvent` would silently fail and the event would never be recreated.

**How to apply:** In `upsertCalendarEvent` (sync-service.ts), check `updated === "not-found"` to delete the stale DB record (`calendarEventsTable`) and call `createEvent` to recreate it. The helper `isEventNotFoundError()` is exported from `calendar-service.ts` for detecting 404 in other contexts.

## Legacy event recovery

**Rule:** Events from before deterministic IDs may enter a tenant-scoped review queue only when they carry a VisiteCRM description marker and exactly match the current title/time/location signature. Association, removal, and dismissal are explicit agency-admin actions.

**Why:** Matching by title or date alone can capture a manually created Google event; automatic association would also make a later sync silently alter or duplicate user-owned calendar data.

**How to apply:** Keep pending candidates outside `calendar_events`; normal sync skips only resources represented by pending candidates. Preserve ambiguous matches as multiple choices and never auto-select one.
