---
name: CRM settings route scope
description: Product decision about which configuration belongs on the main CRM settings route.
---

Keep `/configuracoes` focused on general agency, establishment, and tourism-operation setup: identity, contact, operational identifiers, and general CRM operation preferences. Specialized sections should remain outside this route; legacy section links should land on the general profile. Preserve the separate storefront settings page and the agency-admin backup redirect to Downloads.

**Why:** The user chose the “Só agência e operação turística” scope for this route.

**How to apply:** When adding or moving settings, keep specialized billing, team, integrations, notifications, pipelines, customization, and integrity panels out of `/configuracoes`; retain compatibility redirects for old links.
