# Research Notes: Open-source components for a tourism distribution platform

**Status:** complete — 2026-10-19
**Depth:** Standard

## Plan

- **Question:** Should Visite Cariri extend VisiteCRM, complement it with a focused service, or replace part of it with an open-source platform?
- **Scope:** Official repositories and documentation for Medusa and selected tourism-specific systems; license, maintenance evidence, technical fit, missing capabilities, adaptation risk, and likely effort. No software will be installed or copied.
- **Audience:** Product owner and engineering lead.
- **Deliverable:** Evidence-backed comparison in `docs/audits/2026-10-19-diagnostico-marketplace-turistico-visite-cariri.md`.

## Focus Areas

| # | Area | Status | Sources |
|---|---|---|---|
| 1 | Medusa commerce framework | done | 3 |
| 2 | Tour-operator and booking systems | done | 9 |
| 3 | Lodging booking/PMS alternative | done | 5 |
| 4 | Itinerary and routing component | done | 4 |
| 5 | Standards and integration boundary | done | 2 |

## Coverage Checklist

- [x] Verify each candidate's official repository, license, latest maintenance evidence, and stated capabilities.
- [x] Separate complete commerce/booking systems from narrow components and standards.
- [x] Compare adaptation cost and risk against the CRM's existing code and constraints.
- [x] Cite official sources; label unverified claims, unknown runtime facts, and decision-dependent estimates.
- [x] Do not install, copy, or prototype any candidate.

## Findings Log

_[@key] markers reference sources in `research/sources.json`._

### Candidate evaluation

- Medusa is an extensible commerce framework; its marketplace recipe requires custom vendor models, vendor API/auth, and order-splitting workflows [@medusa-repository] [@medusa-marketplace-recipe].
- TourApp advertises outbound operations but its visible activity ends in 2013 and the checked branch has no LICENSE file [@tourapp-repository] [@tourapp-commit-history] [@tourapp-license-file].
- QloApps is hotel/PMS-oriented; the README states OSL-3.0 for core and PHP/MySQL requirements; latest release v1.7.0 (2025-07-04), latest commit 2026-10-17 [@qloapps-repository] [@qloapps-releases] [@osl-3-license].
- MagePeople's Travelly / Tour Booking Manager is a WordPress/WooCommerce plugin under GPL-2.0 with recent releases; NVD lists versions through 2.3.1 as affected by CVE-2026-62063, but the changelog does not identify the fix [@magepeople-repository] [@gpl-2-license] [@magepeople-wordpress-listing] [@magepeople-nvd-cve] [@magepeople-changelog].
- OpenTripPlanner is a separate Java/JVM routing component, not a booking or supplier-distribution system; latest tagged release observed is 2.10.0 (2026-09-09) [@opentripplanner-repository] [@opentripplanner-license] [@opentripplanner-docs] [@opentripplanner-changelog].
- OpenTravel is a standards organization and tooling ecosystem, not a ready-to-run marketplace; licenses for the specifications and DEx artifacts remain individually unverified [@opentravel-official-site] [@opentravel-github-org].
- Existing VisiteCRM code already includes tenant-scoped store/catalog, trip and lodging paths, reservations, checkout, partner portal, commission snapshots and a financial ledger. These are code findings; see the report's project evidence map.
- The external distribution adapter currently found is `distribution_reference`, restricted to the test environment, with simulated offers/orders and no in-repo public booking client. This is not a live supplier connection.
- Verification boundary: no code, schema, data, integrations or production were changed; no secrets were read. The API server workflow currently fails before starting on the UploadThing patch-marker assertion; one existing store-public assertion failed in a focused test run.

## Conflicts & Open Questions

- A broader search across project docs, task files, source, and research did not find a separate approved "base document"; this cannot establish that a document does not exist outside the workspace.
- NVD records for QloApps and MagePeople are attributed to third parties; affected-version scope and patch status need vendor/release confirmation before either is treated as a confirmed current defect.
- Production readiness, provider accounts, cancellation/refund policy, supplier commissions, payout/settlement rules, and partner procedures require owner/operator validation.

## Gaps

- Candidate list is representative, not exhaustive; no market-share, customer-adoption, or production-support claims are inferred from GitHub activity.
- No independent operational references were found for the candidate systems; their feature descriptions are vendor/project claims, not proof of suitability or readiness.
- The separate approved base document was not found inside this workspace after a broader search; owner confirmation remains required.
- Real supplier/payment integrations, commercial rules, and live operations remain unverified and must be validated before implementation or pilot.

## Completion

- Report: `docs/audits/2026-10-19-diagnostico-marketplace-turistico-visite-cariri.md` (version 1.0).
- Source registry: `research/sources.json` contains 23 stable keys; every source has saved evidence and every source used in the report has a rendered, clickable citation.
- The report covers current capabilities, the open-source comparison, architecture, entity relationships, permissions, risks, backlog, estimates, acceptance criteria, test plan, and deployment plan.
- No functional code, schema/migrations, data, integrations, production environment, or `artifacts/mockup-sandbox` content was changed; no secrets were read.
- Verification limits are recorded in the report: 96/97 focused API tests passed, the API workflow failed on the `_uploadthingPatched` build assertion, and the reported typechecks/schema-drift check passed.
