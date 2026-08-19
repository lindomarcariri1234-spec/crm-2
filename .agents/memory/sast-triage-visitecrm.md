---
name: SAST triage — recurring false positives & fix patterns
description: Which Semgrep "medium" findings in VisiteCRM are real vs recurring false positives, and the source-validation pattern for fixing reflected injection.
---

# SAST triage for VisiteCRM (Semgrep medium findings)

A full security scan reports ~188 medium findings, ~0 critical/high. Most are recurring false positives. Triage rule: for `html-in-template-string`, **trace each interpolated variable to its definition** before flagging — the template literal is flagged for the interpolation, but the value is often already escaped upstream.

## Recurring FALSE POSITIVES (do not "fix" these)
- **trips.ts `generateManifestHtml`**: every header/crew var (tripName, destination, organizador, driver*, tourGuide*, etc.) is pre-escaped at its `const` definition via the local `e = escapeHtmlServer`. The big template just interpolates already-escaped consts.
- **reminder.worker.ts / email-helpers.ts / store-public.ts result page / PassengersListManifest.ts**: each already applies its own escape helper (escapeHtml / escapeHtmlEmail / manual `<`-replace) before interpolation.
- **`ilike(table.col, \`%${x}%\`)`** (clients.ts, trips.ts `/trips` search): `${x}` flows into Drizzle `ilike()`, which is parameterized — not raw SQL/HTML. Flagged as raw-html-format but safe.
- **`new RegExp(\`...${key}...\`)`** in whatsapp.ts `interpolateWhatsAppMessage`: `key` is a hardcoded literal ("nome","codigo","valor",…); now also defended with `escapeRegex()`.
- **serve-static.mjs path traversal**: `new URL(req.url,'http://localhost').pathname` normalizes `..` segments (cannot escape root) and leaves `%2e`/`%2f` percent-encoded, so `path.join(ROOT, pathname)` treats them as literal filenames. Verified empirically — not exploitable.
- **scripts/build.js detect-non-literal-fs-filename / path-join (92x)**: build scripts with no runtime attack surface — ignore.
- **serve.js using-http-server (2x)**: Expo dev serve.js — TLS is handled by Replit's proxy; HTTP internally is fine.
- **landing-page.html missing-integrity (4x)**: Expo landing pages. Minor, not exploitable in practice.
- **mockup-sandbox App.tsx unsafe-dynamic-method**: `mod[name]` where `mod = import.meta.glob()` — the set of accessible modules is fixed at build time; no arbitrary code exec possible.

## REAL issues found & fixed

### HTML injection / XSS
- **nps.ts**: `agencyName` (tenant name) was interpolated raw into the PUBLIC thank-you page served as text/html to the agency's clients → cross-tenant stored XSS. Fixed by escaping.
- **partners.ts commissions PDF**: `partnerName`/`partnerEmail` rows escaped.
- **reminder.worker.ts profileUrl href (fixed June 2026)**: `row.agencyWebsite` from DB was embedded directly as `href` without scheme validation — a malicious tenant could set `website = "javascript:..."`. Fixed: validate `^https?://` before embedding; encode `"` as `%22` for attribute safety.

### ReDoS (defensive fixes)
- **redis.ts `parseField()`**: `new RegExp(\`^${field}:...\`)` — field was always a hardcoded literal, but added `escapeRegex()` helper as defense-in-depth.
- **whatsapp.ts `interpolateWhatsAppMessage()`**: same pattern, same fix.

## Fix pattern: validate attacker-controlled query params at the SOURCE
The `period` query param (partners.ts `/parceiros/commissions`) reached `<title>`, `formattedPeriod`, the CSV body, AND the `Content-Disposition` filename. Instead of escaping each sink, constrain at the source: `/^\d{4}-(0[1-9]|1[0-2])$/` test with fallback to current `YYYY-MM`. One validation neutralizes every downstream sink at once.
**Why:** per-sink escaping is easy to miss one sink (the filename header isn't HTML); a tight source regex makes the value structurally incapable of carrying a payload.

## profileUrl href safety pattern (added June 2026)
Any time a URL from the DB is embedded as an `href` in raw HTML (email or server-rendered):
1. Validate scheme: `if (!/^https?:\/\//i.test(url)) return ""` — blocks `javascript:`, `data:`, etc.
2. Encode attribute context: `url.replace(/"/g, "%22")` — prevents `href="x" onload="..."` injection.
**Why:** tenant-set URLs (website, custom domain) are admin-controlled but not platform-validated at storage time; a compromised admin account or insecure migration could plant a payload.
