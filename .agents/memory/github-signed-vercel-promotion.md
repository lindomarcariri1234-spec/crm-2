---
name: GitHub-signed Vercel promotion
description: Release CI-validated main commits through GitHub's server-side signature without private signing keys
---

**Rule:** Keep Vercel's verified-commit gate enabled. After main CI succeeds, promote a source commit only when GitHub reports its verification reason as `unsigned`. Use GitHub's server-side commit API with an expected main head and a tracked release marker. Confirm the resulting commit is GitHub-verified and still `main` before relying on Vercel. Compare the deployed publication marker to that exact SHA. For any other signature reason or a failed verification, stop without a manual bypass or private-key fallback.

**Why:** The user chose server-side signing to preserve Vercel's commit-integrity gate without storing a signing key in the repository.

**How to apply:** Keep write permissions limited to the promotion job, include the release marker in Vercel's deployment-path filter, and run a post-deployment smoke check against the promoted SHA. After changing this path, confirm on a controlled main release that the Actions token can create the signed commit and Vercel receives the resulting push.