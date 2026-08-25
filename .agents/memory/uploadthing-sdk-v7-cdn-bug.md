---
name: UploadThing signed CDN uploads
description: Presigned CDN upload URLs must remain byte-for-byte intact; strip only the SDK-added Range header when it causes signature failures.
---

## Rule
When an UploadThing CDN PUT request fails signature validation because the SDK adds `Range: bytes=0-`, remove that header and normalize one extra URL-encoding layer before sending.

**Why:** The CDN normally expects canonical query encoding, but signing configurations can differ. A one-time “Invalid signature” retry with the provider-issued URL resolves that safely and establishes the representation for later uploads.

**How to apply:** Preserve the method, body, and non-Range headers. On a signature-specific failure after canonical normalization, retry the original URL once and retain the successful representation. Re-verify a disposable upload after SDK or HTTP-layer changes.
