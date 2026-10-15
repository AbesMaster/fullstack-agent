# Production readiness checklist

Tick each item with a date and initials. Production deploys need **owner approval** after every box in sections A–D is ticked.

## A. Accounts and credentials
- [ ] Managed Postgres (pgvector) for staging and production, with backups + PITR enabled
- [ ] Hosting for app and worker/cron; custom domain + TLS
- [ ] Stripe account verified; test-mode run complete; live keys stored in the secret manager
- [ ] HubSpot private app (least-privilege scopes); custom properties `felicia_source`, `felicia_marketing_consent`, `felicia_reference` created
- [ ] Google service account with calendar shared to it
- [ ] Zoom Server-to-Server OAuth app created on a Pro (or higher) licence; credentials stored
- [ ] Resend domain verified (SPF, DKIM, DMARC)
- [ ] Anthropic API key with a spend limit set
- [ ] `SESSION_SECRET`, `DATA_ENCRYPTION_KEY` and `CRON_SECRET` generated, stored, and the encryption key backed up offline

## B. Verification in staging (real providers, test mode)
- [ ] Discovery call booking → calendar event appears → Zoom meeting appears in Felicia's Zoom → confirmation email contains the join link
- [ ] Rescheduling moves the Zoom meeting; cancelling deletes it
- [ ] Paid booking → Stripe test card → webhook verified → booking confirmed → receipt + preparation emails
- [ ] Replayed webhook does not double-record
- [ ] Refund request → approval → Stripe test refund appears
- [ ] Enquiry → HubSpot contact created with no sensitive fields
- [ ] Marketing email only to consented contacts; unsubscribe works (link and one-click)
- [ ] Emergency stop halts the worker and chat
- [ ] Financial report reconciles with the Stripe test dashboard
- [ ] Backup restore tested into a scratch database

## C. Security
- [ ] Owner + admin accounts created with MFA; no demo users in production
- [ ] Consider a managed auth provider (passkeys, recovery) and migrate users
- [ ] Add Postgres exclusion constraint on booking time ranges (database-level double-booking guard)
- [ ] Distributed rate limiter if running more than one instance
- [ ] Dependency audit (`npm audit`) and update; enable Dependabot
- [ ] Content-Security-Policy header tuned for the chosen analytics/fonts

## D. Content, legal and compliance (see COMPLIANCE_CHECKLIST.md)
- [ ] Prices approved (all services set to Active)
- [ ] Biography, photos, logo, credentials provided and verified
- [ ] Privacy, Terms and Cancellation reviewed by a UK solicitor; all [CONFIRM] items resolved
- [ ] Consent form wording and breathwork screening reviewed (ideally with the insurer)
- [ ] ICO registration (data protection fee) confirmed
- [ ] Professional indemnity / public liability insurance confirmed and referenced

## E. Go-live
- [ ] `APP_ENV=production`, `robots` indexing on, Open Graph image added
- [ ] Production deploy approved by Felicia; version recorded
- [ ] First live transaction verified end-to-end; status moved to LIVE AND VERIFIED in docs/STATUS.md
