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
