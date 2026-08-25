---
name: Resend production verification
description: Constraints and checks for verifying a production sender domain through the Replit Resend connection
---

The Replit Resend connection can be restricted to sending only, so domain listing and DNS-record management may return an authorization error even while email sending works. Sender-domain verification must be completed in the Resend account connected to the production environment, with public DNS records propagated, before delivery testing.

**Why:** A send request is the reliable end-to-end check: Resend rejects an unrecognized sender domain even when `RESEND_FROM_EMAIL` is configured correctly.

**How to apply:** Confirm the exact domain and account in Resend, set `RESEND_FROM_EMAIL` only to an address at that verified domain, then send one real CRM-style message through the production connector. Do not treat a successful environment-variable update as proof of verification.