# Deployment

## Environments
| Env | Database | Payments | Purpose |
|---|---|---|---|
| development | PGlite (`.data/`) | mock | local work, demo seed |
| staging | managed Postgres (separate DB) | Stripe **test** keys | full rehearsal with real providers in test mode |
| production | managed Postgres with daily backups + PITR | Stripe live keys | only after owner sign-off |

## Recommended managed services (low fixed overhead)
- App: Vercel or Render (Node 20+). Worker: Render background worker, or a cron hitting `POST /api/cron/drain` with `Authorization: Bearer $CRON_SECRET` every minute, plus a 5-minute job running `runDueJobs` (or run `npm run worker`).
- Database: Neon or Supabase Postgres with `pgvector`.
- Email: Resend with SPF/DKIM/DMARC on metamastermindz.com.

## Steps (staging first)
1. Create the database and set `DATABASE_URL`. Run `npm run db:migrate`.
2. Set every variable in `.env.example` (generate secrets with `openssl rand -base64 48` / `-base64 32`). Store them in the host's secret manager, never in Git.
3. `ADMIN_PASSWORD=… npx tsx scripts/create-admin.mts felicia@… "Felicia Stefan" owner`. Scan the printed otpauth URL into an authenticator.
4. Stripe: add a webhook endpoint `https://<host>/api/webhooks/payments` for `checkout.session.completed`, `checkout.session.async_payment_failed`, `checkout.session.expired` and `charge.refunded`.
5. Deploy, then run the smoke checks: `/api/health`, book a discovery call, complete a Stripe **test-card** payment, confirm the booking shows as confirmed and the emails arrive.
6. Record the deployed version (git SHA) and the result in the deployment log.

## CI
`.github/workflows/felicia-os.yml` runs typecheck, unit/integration tests, the production build and E2E tests on every push and PR touching `felicia-os/`.

## Backups and restore
- Enable provider daily backups and point-in-time recovery. **Test a restore** into staging before launch and quarterly after that.
- Back up `DATA_ENCRYPTION_KEY` separately and securely. Without it, encrypted intake forms cannot be read.

## Rollback
- App: redeploy the previous build (Vercel/Render one-click).
- Database: migrations are additive. If a migration must be undone, restore from PITR to just before deploy, then replay webhook events from Stripe.
