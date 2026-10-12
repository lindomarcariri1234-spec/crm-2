---
name: Instagram provider rollout
description: Decision for introducing Zernio alongside the existing direct Meta Instagram integration.
---

Keep the direct Meta Instagram integration active while validating Zernio as a separate provider. Do not overwrite or disconnect the Meta integration as part of adding the Zernio webhook.

**Why:** the user chose parallel operation during validation so the existing inbox flow is not interrupted.

**How to apply:** store Zernio connections under a distinct integration type and route each conversation through its recorded provider. Treat any later provider cutover as a separate user decision.
