# Operating procedures

## Automated schedule (worker / cron, Europe/London)
| When | Agent | What |
|---|---|---|
| Every 5 min | Scheduling | Release unpaid holds older than 30 min; send 24-hour reminders (once each) |
| Every 5 min | Client Experience | Mark ended sessions completed; thank-you / post-discovery follow-up; optional feedback request 24 h later |
| 07:00 | Executive Ops | Daily brief: today's sessions, open enquiries, approvals, attention items, unpaid bookings |
| 08:00 | Financial Intelligence | Budget alerts (marketing, expense threshold, refund rate, startup ceiling, event overruns) |
| 19:00 | Executive Ops | Evening summary |
| Mondays 08:00 | Commander | Weekly report (actual / forecast / target kept separate) |
| 1st of month 08:00 | Financial Intelligence | Monthly report |

Every job is idempotent, recorded under **Agents → Recent activity**, and skipped while the emergency stop is on.

## Human routines
- **Daily (10 min):** open the Overview, clear approvals, read "Needs your attention", reply to escalated enquiries personally.
- **Before each breathwork session:** check "review needed" welcome forms. Adapt or postpone the session if there is any doubt.
- **Weekly:** read the weekly report, check content queued for approval, look at dead-lettered events (Agents page).
- **Monthly:** review pricing assumptions, marketing spend against budget, retention, and the compliance checklist.

## Escalation rules (built in)
- Crisis language in chat → the assistant shows emergency contacts (999 / Samaritans 116 123) and flags you.
- Medical questions → no advice given; flagged to you.
- Refunds, complaints, legal threats → routed to a person; refunds always need approval.

## Incidents
1. Press **Emergency stop**.
2. Note what happened (Audit log, Agents page).
3. Payment problem: check Stripe dashboard webhooks. Suspected data issue: rotate `SESSION_SECRET` and API keys, then follow your ICO breach procedure (72-hour reporting window for notifiable breaches).
4. Fix, then retry dead-lettered events and resume.
