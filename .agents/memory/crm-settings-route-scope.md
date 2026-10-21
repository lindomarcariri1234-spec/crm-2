---
name: CRM settings route scope
description: Product decision about which configuration belongs on the main CRM settings route.
---

`/configuracoes` includes general agency and tourism-operation setup, the Plano/Equipe/Chaves API/Integrações/Notificações/Funcionalidades/Pipelines settings, Personalização, and Clube. Integridade is agency-admin-only. Backup remains in Downloads with its legacy redirect.

**Why:** The user first narrowed the page, then explicitly requested that the settings tabs shown in their reference be restored and functional.

**How to apply:** Keep the listed existing settings panels reachable from the horizontal navigation and direct `?tab=` links. Preserve role gating for Integridade and keep backup in Downloads.
