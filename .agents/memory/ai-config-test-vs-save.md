---
name: AI integration Test vs Save status model
description: Why "Testar Conexão" is transient and only Save persists connection status in the per-tenant AI config.
---

For the per-tenant AI provider config (Configurações → Integrações), "Testar
Conexão" (POST /ai-integration/test) MUST validate the values the admin currently
has in the form — including unsaved key / base URL / model — and MUST work without
requiring Save. The test route is transient: it never writes status/lastSyncAt/
lastError. The persisted connection status comes ONLY from PUT /ai-integration,
which after saving runs its own server-side auto-test and writes connected/error.

**Why:** A "status consistency" change that forced save-before-test was rejected
in code review because it violated the acceptance criterion ("Test must validate
credentials WITHOUT requiring Save"). Decoupling them keeps both invariants:
test-pre-save works, AND the stored status can never diverge from the saved config
(an ad-hoc probe of unsaved values can't corrupt the badge).

**How to apply:** If you ever make the test route persist status (or gate testing
on a clean/saved state), you are re-introducing the rejected coupling. Keep test
transient; let Save own status. The masked-key sentinel ("••••••••") / empty key
means "use the saved key" on both test and save paths.
