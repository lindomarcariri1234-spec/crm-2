---
name: Instagram provider rollout
description: Decision for introducing Zernio alongside the existing direct Meta Instagram integration.
---

Keep the direct Meta connection active alongside Zernio; route each reply through the provider recorded on its conversation instead of globally switching providers.

**Why:** the user chose parallel operation during validation so the existing inbox flow is not interrupted, then explicitly requested that CRM replies to Zernio conversations use Zernio.

**How to apply:** store Zernio connections under a distinct integration type and route each conversation through its recorded provider. Treat any later global provider cutover as a separate user decision.
