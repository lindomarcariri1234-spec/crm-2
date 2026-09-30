---
name: Pipeline stage vs. client classification
description: Product invariant separating automatic client classification from the actual business-deal stage.
---

`deals.stageId` is authoritative for a Pipeline card's stage and movement. `clients.classification` is the automatic client-profile classification: show it as separate context, never as a deal stage. `clients.pipelineStage` is legacy data; if shown, keep it read-only, exclude it from routine client updates, and never use it to place or move cards.

**Why:** The board's stage can advance from reservation and trip events, while client classification describes the customer's profile. Treating them as the same status gives users a misleading view and can conflict with automation.

**How to apply:** Filter, group, and move deal cards by `deals.stageId`. Display client classification separately. Preserve legacy `clients.pipelineStage` only for reference, not as an authority for the Pipeline.