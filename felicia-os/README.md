# FELICIA OS

The AI-assisted business operating system for **MetaMasterMindz**, Felicia Stefan's spiritual wellness and personal development practice. Part of the METAMASTERMINDZ ecosystem; it can report to JARVIS OS, but it runs on its own.

> *Explore the Earth. Open the Heart. Remember Who You Are.*

It includes:

- **The public website.** 16 pages plus booking, event registration, a password-free client portal, checkout, client welcome form, feedback and unsubscribe pages, with a clearly labelled AI chat assistant.
- **The Felicia Command Center** (`/admin`). Business performance, approvals, enquiries and bookings, events, finance, analytics, content, services, knowledge, the 21 agents, an audit log and an emergency stop.
- **A multi-agent layer.** Felicia Commander plus 20 specialist agents. Each one has a fixed tool allow-list, actions it can only *request* (never perform), hourly limits and a task history. Agents hand work to each other through typed events, not free-form chat.
- **Integrations.** Stripe (hosted checkout and signed webhooks), HubSpot, Google Calendar, Zoom, Resend email, Anthropic Claude and the JARVIS connector. Each one runs against a clearly labelled **mock** until real credentials are added.

## Quick start (development)

```bash
cd felicia-os
npm install
cp .env.example .env.local            # optional in dev: everything works with mocks
npm run db:seed:demo                  # FICTIONAL demo data, labelled (DEMO); prints a demo login + authenticator URL
npm run dev                           # http://localhost:3000   ·   Command Center: /admin
npm run worker                        # separate terminal: workflow outbox + daily/weekly schedule
```

In development the database is **PGlite**, a real PostgreSQL with pgvector that runs in-process and stores its data in `.data/`. Staging and production use a managed PostgreSQL through `DATABASE_URL`.

## Checks

```bash
npm run typecheck
npm test                              # 86 unit/integration tests against real Postgres (PGlite)
npm run build
npm run test:e2e                      # 8 browser end-to-end tests (needs a Chromium; set PW_CHROMIUM_PATH if preinstalled)
```

## Documentation

| Document | What it covers |
|---|---|
| [docs/STATUS.md](docs/STATUS.md) | **Implementation status of all 25 deliverables**, what's blocked, and why |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data model, agents, events, security |
| [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) | Plain-English guide for Felicia: running the business without touching code |
| [docs/OPERATING_PROCEDURES.md](docs/OPERATING_PROCEDURES.md) | Daily, weekly and monthly routines, escalations, incidents |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Environments, CI/CD, migrations, backups, rollback |
| [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) | The launch checklist |
| [docs/COMPLIANCE_CHECKLIST.md](docs/COMPLIANCE_CHECKLIST.md) | UK GDPR, PECR, ASA/CAP, consumer law, Qatar: items for professional review |
| [docs/JARVIS_CONNECTOR.md](docs/JARVIS_CONNECTOR.md) | The parent-system adapter contract |

## Honesty rules built into the code

- Actual results, forecasts and targets are computed separately and labelled separately.
- Integrations show "credentials configured (not verified)" or "not connected — using mock". Nothing is ever shown as live unless it has been verified.
- No testimonials, credentials, biography or photos are invented. Missing assets are shown as visible **Asset needed** placeholders.
- All prices start as **proposed** until Felicia approves them in the Command Center.
