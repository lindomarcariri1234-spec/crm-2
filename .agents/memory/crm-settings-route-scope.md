---
name: CRM settings route scope
description: Product decision about which configuration belongs on the main CRM settings route.
---

Keep `/configuracoes` focused on general agency, establishment, and tourism-operation setup, plus the Clube relationship-program settings. Other specialized sections should remain outside this route; their legacy links should land on the general profile. Preserve the separate storefront settings page and the agency-admin backup redirect to Downloads.

**Why:** The user chose the general agency/tourism scope, then explicitly asked to restore navigation and viewing for Clube.

**How to apply:** Keep Clube as the sole specialized exception in `/configuracoes`. Keep billing, team, integrations, notifications, pipelines, customization, and integrity panels elsewhere; retain compatibility redirects for their old links.
