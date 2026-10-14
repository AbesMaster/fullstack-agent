# FELICIA OS — Architecture

## Shape

```
                 ┌─────────────────────────── Next.js app (TypeScript) ───────────────────────────┐
 Visitors ──────▶│ Public site  ·  Booking  ·  Intake  ·  AI chat     │  /api/* (validated, rate-limited, CSRF-checked)
 Felicia/team ──▶│ Command Center (/admin, RBAC + MFA)                │
 Stripe ────────▶│ /api/webhooks/payments (signature verified on raw body)
                 └───────────────┬────────────────────────────────────────────────────────────────┘
                                 │ domain modules (src/lib/*)
                                 ▼
          PostgreSQL + pgvector ◀── transactional OUTBOX (domain_events) ──▶ Worker / cron
                                 │                                          │
                                 │      typed events → agent handlers ──────┘
                                 ▼
     Provider adapters: Stripe · HubSpot · Google Calendar · Resend · Anthropic · JARVIS
     (each with a labelled mock, chosen automatically when credentials are absent)
```

Deliberately **one deployable app plus one worker process** with no n8n, queue broker or microservices. The outbox table gives durable jobs, retries with backoff, a dead-letter state and idempotency without extra infrastructure. If volume ever demands it, the bus interface can move to a hosted queue.

## Modules (`src/lib`)

| Module | Responsibility |
|---|---|
| `db/` | Drizzle schema (23 tables) and client: node-postgres for production, PGlite for dev/tests |
| `services/` | Configurable service catalogue (all prices start as *proposed*) |
| `booking/` | Contacts, enquiries, availability (time zones, notice, buffers, external busy), booking, reschedule, cancel, encrypted intake |
| `payments/` | Provider interface (Stripe and mock), normalised webhooks, idempotent payment recording, approval-gated refunds |
| `crm/`, `calendar/`, `email/` | Provider adapters. The email layer enforces consent, suppression and unsubscribe |
| `events/` | Typed event schemas and outbox bus: exactly-once handler receipts, backoff, DLQ, emergency-stop aware |
| `agents/` | Registry (21 agents), permission and approval controls, event workflows, scheduled operations, website conversation agent |
| `ai/` | Claude drafting client: structured outputs, model tier by task, untrusted text fenced as data |
| `finance/` | Monthly actuals, scenario forecasts, budget alerts, event profitability |
| `knowledge/` | Ingestion (PDF/DOCX/TXT/MD/CSV/JSON/URL), chunking, versioning, pgvector retrieval with access levels |
| `compliance/` | Claim checker (blocks cure/guarantee claims), escalation detector, crisis response |
| `content/` | Marketing pipeline with compliance and approval |
| `jarvis/` | Parent-system connector contract, privacy redaction, transports |
| `auth/`, `security/`, `audit/` | scrypt, signed sessions, TOTP MFA, RBAC; AES-GCM; HMAC tokens; append-only audit |

## Agent model

Agents are **code-defined roles**, not open-ended chatbots:

- `registry.ts` fixes each agent's `tools`, the `mayRequest` actions it can only *request*, and its `limits`. Nothing at runtime can change these. No agent holds a money-moving or publishing tool; a test enforces this.
- Gated actions (publish, marketing email, ads, price change, refund, spend, sign, venue, production change, sensitive export, permission change) can only enter the system through `requestApproval()`. They execute only in `executeApproved()`, which re-checks that the approval was granted by an owner or admin.
- Work flows through typed events: `LEAD_CREATED → CRM sync → qualification → welcome email → sales follow-up task`, `PAYMENT_CONFIRMED → confirm booking → calendar → receipt → preparation email → CRM deal`, and so on (see `agents/workflows.ts`).
- Claude is used **only to draft** (chat replies, content). The model never gets tools that act. Client messages and retrieved documents are wrapped as `<client_message>` / `<document>` data, and the system prompt forbids following instructions inside them.

## Data protection design

- **CRM gets the minimum.** Name, email, phone, lifecycle and consent only. `assertNoSensitiveFields` refuses health-like keys.
- **Intake and health screening** are encrypted with AES-256-GCM using `DATA_ENCRYPTION_KEY`, stored separately from contacts, readable only by the `owner` role, and every read is audited.
- **Audit log** records actions, never payload contents.
- **JARVIS reports** are aggregate and pass through `redactForParent()`.

## Key decisions and trade-offs

- **Lexical embeddings by default.** Anthropic has no embeddings endpoint, and a hosted embedder needs an account. The local feature-hashing embedder works offline and is deterministic. Swap in Voyage AI or similar by implementing `Embedder`.
- **Custom auth on proven primitives** (scrypt, jose JWT, otplib TOTP) rather than a hosted provider, because no provider account was available. Before launch, consider moving to a managed provider (Clerk, Auth0) for passkeys and account recovery. This is listed in PRODUCTION_READINESS.
- **In-memory rate limiting** works for a single instance. With multiple instances, use Redis/Upstash.
- **Booking race condition**: there is an insert-then-recheck with a deterministic winner. In production Postgres, add a `tstzrange` exclusion constraint for a database-level guarantee (in the checklist).
