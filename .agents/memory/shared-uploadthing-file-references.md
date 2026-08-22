---
name: Shared UploadThing file references
description: Safe cleanup of UploadThing files after deleting records that may share URLs.
---

When a record is deleted before its UploadThing file is cleaned up, check for any
remaining same-tenant references to that file as well as cross-tenant references.
The deletion may be safe for the record but unsafe for another record using the
same URL.

**Why:** URL uniqueness is not enforced across tenant records. A cross-tenant-only
guard can remove a file that a different trip or asset in the same tenant still
displays.

**How to apply:** For cleanup that runs after a database deletion or cascade, use
the same-tenant reference check option. Keep the default cross-tenant-only guard
for flows that check before their own database record has been removed.