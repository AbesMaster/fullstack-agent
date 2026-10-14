# JARVIS connector

FELICIA OS runs on its own. It can optionally report to the parent **JARVIS OS** through `src/lib/jarvis/connector.ts`.

**No JARVIS documentation, API schema or credentials were available**, so no endpoints were assumed. What exists:

## Contract (what FELICIA OS offers)
Outbound reports, all aggregate:
- `business_status`: period, actual recognised revenue (or null), bookings count, pending approvals, system health
- `agent_performance`: per-agent succeeded/failed/blocked counts
- `revenue_report`: actual recognised and cash, target, base forecast (each labelled)
- `system_alert`: severity and message

Inbound: `JarvisTask` (delegated tasks). **Delegated tasks are never executed directly.** Each one must become an approval request in the Command Center.

## Privacy
Every outbound report passes through `redactForParent()`, which drops client-identifying keys and masks emails and phone numbers. Client records, intake data and messages are never shared. Reports are only sent when the connector is enabled and the report type is on the allow-list.

## Transports
- `MockJarvisTransport`: used in tests, and whenever JARVIS isn't configured (the connector is then **disabled**).
- `SignedWebhookTransport`: a generic HMAC-SHA256-signed POST (`x-felicia-timestamp`, `x-felicia-signature`) with configurable paths. Use it only once JARVIS confirms it accepts this shape; otherwise write a transport to match the real spec.

## To connect
1. Obtain the JARVIS API spec and a scoped token.
2. Implement or configure the transport; add contract tests against the spec.
3. Set `JARVIS_BASE_URL` and `JARVIS_API_TOKEN` in staging and verify. Then update docs/STATUS.md.
