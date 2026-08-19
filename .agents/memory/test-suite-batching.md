---
name: Test suite batching
description: How to run the full test suite within the 120s bash timeout limit
---

The workspace has 76 backend test files and 16 frontend test files. Running all of them in a single `vitest run` command exceeds the 120-second bash timeout.

**Why:** The bash tool has a hard 120s cap. The full backend suite takes ~3–4 minutes (some tests hit the real PostgreSQL DB and hold connections). The frontend vitest also exceeds 60s when all 16 files run together (jsdom environment setup overhead).

**How to apply:** Split into batches by first letter of filename:

Backend (`artifacts/api-server`):
```bash
# Batch 1 — a-c (≈22 files, ≈340 tests, ≈50s)
FILES=$(ls src/__tests__/[a-c]*.test.ts 2>/dev/null | tr '\n' ' ')
pnpm exec vitest run --reporter=dot $FILES

# Batch 2 — d-l (≈15 files, ≈160 tests, ≈35s)
FILES=$(ls src/__tests__/[d-l]*.test.ts 2>/dev/null | tr '\n' ' ')
pnpm exec vitest run --reporter=dot $FILES

# Batch 3 — m-r (≈21 files, ≈250 tests, ≈40s)
FILES=$(ls src/__tests__/[m-r]*.test.ts 2>/dev/null | tr '\n' ' ')
pnpm exec vitest run --reporter=dot $FILES

# Batch 4 — s-z + workers (≈19 files, ≈200 tests, ≈28s)
FILES=$(ls src/__tests__/[s-z]*.test.ts src/workers/*.test.ts 2>/dev/null | tr '\n' ' ')
pnpm exec vitest run --reporter=dot $FILES
```

Frontend (`artifacts/visitecrm`) — batches of 8 files, each runs in ~20s:
```bash
# Pass the file paths explicitly; glob discovery causes timeout
pnpm exec vitest run src/__tests__/FileA.test.ts ... src/__tests__/FileH.test.ts --reporter=dot
```

Batches 2 & 3 (backend) and the two frontend batches can be launched in parallel since they hit independent DB schemas/namespaces and don't share state.
