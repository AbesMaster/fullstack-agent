# Going live: step by step

Everything is built and tested. What's left needs **Felicia's own accounts and decisions**: nobody else can open a Stripe account in her name, own her domain, or approve her prices and legal terms. Each step says who does it and roughly what it costs.

The rule throughout: **rehearse first, then launch.** The site starts as *staging* (test payments, hidden from search engines). It switches to *production* only when the launch check passes and Felicia says yes.

## 1. Decisions (Felicia, free)
- [ ] Approve or change the ten prices (Command Center → Services; setting a service to **Active** approves its price).
- [ ] Confirm the public email address (currently `hello@metamastermindz.com`).
- [ ] Book a UK solicitor to review the Privacy, Terms and Cancellation pages. Every gap is marked **[CONFIRM]**.

## 2. Accounts (Felicia opens them, in her business's name)
| Account | What it's for | Needed to launch? | Cost |
|---|---|---|---|
| **Domain** (metamastermindz.com) | The website address and email sending | Yes | ~£10–20/year (if not already owned) |
| **Render** (render.com) | Hosts the website, background worker and database | Yes | ≈ $20/month |
| **Stripe** (stripe.com) | Card payments | Yes | 1.5% + 20p per UK card, no monthly fee |
| **Resend** (resend.com) | Booking confirmations, sign-in links, receipts | Yes | Free up to 3,000 emails/month |
| **Zoom** Pro | Online sessions and online events | Yes, if offering online sessions | ~£12/month |
| **Google Calendar** | Stops bookings clashing with her own diary | Recommended | Free |
| **Anthropic** (console.anthropic.com) | Smarter website assistant and drafting | Optional | Pay as you go |
| **HubSpot** | CRM | Optional | Free tier |

## 3. Set up hosting (about 30 minutes, can be done together on a call)
1. In Render: **New → Blueprint**, choose the `fullstack-agent` GitHub repository. Render reads `render.yaml` and creates the website, worker and database in the EU.
2. Paste in the keys it asks for (from Stripe **test mode**, Resend, Zoom, Google). Leave optional ones blank.
3. Copy `DATA_ENCRYPTION_KEY` from Render into a password manager. Without it, client intake forms can't be read.
4. Press **Deploy**. Then, in the Render shell for the website:
   `ADMIN_PASSWORD='…' npx tsx scripts/create-admin.mts felicia@… "Felicia Stefan" owner` and scan the code into an authenticator app.
5. In Stripe (test mode) add a webhook to `https://<your-site>/api/webhooks/payments` for `checkout.session.completed`, `checkout.session.async_payment_failed`, `checkout.session.expired` and `charge.refunded`. Paste its signing secret into Render.
6. In Resend, add the domain and put the DNS records it shows into the domain's settings.
7. Point the domain at Render (Render → Settings → Custom Domains), then set `APP_URL` to `https://metamastermindz.com`.

## 4. Launch check
In the Render shell for the website:
```
npm run preflight -- --verify
```
It checks every setting, then makes **read-only** calls to Stripe, Resend, Zoom, Google, HubSpot and Claude to prove each connection works. Nothing is sent, charged or booked. It lists anything still blocking launch in plain English.

## 5. Rehearsal (staging)
- Book a discovery call and a paid session with a Stripe **test card** (4242 4242 4242 4242).
- Register for a test event. Sign in to the client portal from the emailed link.
- Check the confirmation emails arrive, the Zoom link works, and the booking shows in the Command Center.

## 6. Launch (only with Felicia's sign-off)
1. Swap Stripe to **live** keys and create the live webhook.
2. Set `APP_ENV` to `production`. The launch check now treats unapproved prices, open [CONFIRM] markers and a missing Zoom connection as blocking.
3. Run `npm run preflight -- --verify` again. Launch only when it says **Ready**.
4. Deploy, make one small real booking, refund it, and record the date and version in the deployment log.

After launch, statuses on the status page move to **LIVE AND VERIFIED** only for the parts that passed a live check.
