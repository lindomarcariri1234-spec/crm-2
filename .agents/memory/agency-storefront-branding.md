---
name: Agency and storefront branding boundaries
description: Distinguishes admin-panel identity settings from public Vitrine branding and operational delivery preferences.
---

Keep the agency admin-panel colors and logo in agency Personalização, not duplicated in Agência profile. Keep storefront colors, logo, and banners in Loja → Aparência. Keep checkout delivery behavior such as PIX QR delivery in Loja → Pagamentos. These settings use different sources and save paths; grouping them nearby must not merge their values.

**Why:** The admin-panel identity is stored on the tenant, while public Vitrine branding is stored in store settings; PIX QR delivery is an operational tenant setting exposed through the store settings API.

**How to apply:** When organizing settings, consolidate duplicate controls only when they edit the same data. Move distinct product settings to their canonical section and use direct links rather than duplicate editors.
