# Stripe Checkout deployment

This service creates hosted Stripe Checkout Sessions and verifies Stripe webhook signatures before atomically accepting events into the Redis Stream `billing.subscription.events`. Queue acceptance is not itself payment fulfillment or entitlement activation.

## Required configuration

Set these values in the deployment platform's encrypted environment/secrets store:

- `STRIPE_SECRET_KEY`: restricted or secret API key for the intended Stripe account; configure the same mode/account key in both the API and worker services.
- `STRIPE_WEBHOOK_SECRET`: signing secret for this exact webhook endpoint, on the API service only.
- `STRIPE_ALLOWED_PRICE_IDS`: comma-separated allowlist of Price IDs that exist in the same Stripe mode as the configured API key. Configure a mode-specific list for the test deployment and a separately verified list for production.
- `STRIPE_SUCCESS_URL`: HTTPS return URL after successful Checkout.
- `STRIPE_CANCEL_URL`: HTTPS return URL after cancellation.

Do not commit `sk_live_`, `rk_live_`, or `whsec_` values. The connected Stripe account is determined by the API key; the account ID is not used as authentication.

## Stripe Dashboard configuration

Create a webhook destination pointing to:

`https://YOUR_API_HOST/v1/webhooks/stripe`

Subscribe to this exact ClearGlass event set:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `charge.dispute.created`

Copy the signing secret for this exact endpoint into `STRIPE_WEBHOOK_SECRET`. Keep test and live endpoint secrets separate. Do not register the live endpoint until the production API URL is confirmed and the downstream billing-event consumer has passed an end-to-end test.

## Create a Checkout Session

`POST /v1/billing/checkout-sessions`

```json
{
  "priceId": "price_...",
  "quantity": 1,
  "customerEmail": "buyer@example.com",
  "clientReferenceId": "internal-customer-or-order-id"
}
```

Successful response:

```json
{
  "id": "cs_...",
  "url": "https://checkout.stripe.com/..."
}
```

Checkout mode is derived from the retrieved Price: active allowlisted one-time prices use payment mode; recurring prices use subscription mode. Inactive, inconsistent, non-allowlisted, or wrong-mode prices are rejected. Redirect the browser to `url`. Never collect card numbers directly in this API.

## GitHub Actions secrets

Configure the following GitHub Actions secrets in the protected `production` environment or the repository secret store: `RENDER_DEPLOY_HOOK_URL` (the API service hook) and `RENDER_WORKER_DEPLOY_HOOK_URL` (the worker service hook). Retrieve each secret URL from that service’s Render Settings page; never paste either value into code, issues, Slack, or logs. The workflow requires both hooks and deploys the exact validated commit to both services. Render hook URLs cannot be inferred from a hostname. Do not expose Stripe secrets to pull-request workflows from forks, build logs, client-side bundles, or static GitHub Pages.

## Webhook delivery and release gates

- The route uses `express.raw({ type: "application/json" })` before any JSON parsing and passes the original Buffer to Stripe's official SDK. The SDK checks the signature and timestamp tolerance.
- Test/live event mode must match the configured Stripe API key mode.
- A Redis Lua script atomically checks the seven-day event-ID idempotency key and appends the verified event to the `billing.subscription.events` Redis Stream.
- The separate `clearglass-stripe-worker` service consumes the stream with a Redis consumer group, reclaims abandoned entries, retries failures, and moves poison events to `billing.subscription.events.dead` after five failed attempts.
- A second Redis Lua script atomically writes a one-year processed-event marker and the corresponding billing ledger records. Replayed events do not reapply those ledger effects; older state snapshots cannot overwrite newer records.
- The consumer maintains checkout, invoice, subscription-lifecycle, dispute, and customer-risk ledger records. Failed invoice payments are recorded without fabricating cancellation. Disputes are flagged for review and do not automatically refund payments or revoke all access.
- A verified duplicate returns HTTP 200. Missing server configuration or Redis enqueue failures return non-2xx so Stripe retries. Invalid signatures return HTTP 400.
- The billing ledger deliberately remains `billingAccessState: "unlinked"`: there is no authenticated application-user-to-Stripe-customer mapping in this repository. This worker therefore does **not** grant or revoke premium entitlements or claim fulfillment. That separate identity/authorization model and an end-to-end signed test-mode run are release gates.
- CI runs the enqueue/idempotency Lua scripts against an isolated local Redis database 15. Test-mode endpoint delivery is still separate from CI and must be proven against the deployed host before the live endpoint is created. Set `STRIPE_SECRET_KEY` separately on the API and worker services using the same test-mode account/key during test acceptance; set the API-only `STRIPE_WEBHOOK_SECRET` to the test endpoint secret, and configure the API `STRIPE_ALLOWED_PRICE_IDS` with approved test-mode prices. Use different values for production. Do not create the production webhook endpoint until the deployed test-mode endpoint and worker pass signed event, duplicate-delivery, invoice-failure, invoice-paid, cancellation, and dispute tests.
- Do not log signing secrets, signature values, raw request bodies, or full Stripe events.
- Server-side Price ID allowlist, quantity bounds, HTTPS enforcement for production redirects, and hosted Checkout remain in place so card data does not traverse ClearGlass infrastructure.

---

# Membership subscriptions (Signal, Assurance, Northstar)

Status: **implemented and covered by automated tests; not verified end-to-end against a real Stripe account, SMTP provider or deployed host.** Do not describe it as production-ready until the launch checklist below is complete.

## Architecture

- **Static website** (`pricing.html`, `assets/subscriptions.js`): an isolated "Membership" section. It reads public plan state from the account API and links to the approved account origin. It never grants access and never runs checkout. The `<meta name="clearglass-account-origin">` tag is intentionally empty in the repository: set it to the real account origin once known. While empty, the page says membership is not yet available and shows no prices.
- **API** (`src/server.js`, `src/subscriptions/*`): Express, same-origin account pages (`/account*`), JSON endpoints and the protected subscriber area. The existing generic `/v1/billing/checkout-sessions` endpoint is unchanged except that it refuses membership Price IDs.
- **Worker** (`src/stripe-worker.js`): the existing Redis-stream consumer (retry, dead-letter, canonical Stripe fetches, dispute handling). For subscription events it now first commits subscriber state to Postgres in one transaction, then applies the existing Redis ledger and acknowledges. A Postgres failure leaves the stream entry pending for retry.
- **Postgres (new dependency)**: authoritative store for users, sessions, Stripe customer mapping, subscriptions, entitlements, processed events and audit. Redis remains the webhook queue only.
- **Email (new dependency)**: SMTP, used only for passwordless sign-in links. If SMTP is not configured, sign-in fails closed (503); there is no bypass or development back door in any mode.

### Plans

| Offer ID | Env var | Notes |
| --- | --- | --- |
| `signal_monthly` | `STRIPE_PRICE_SIGNAL_MONTHLY` | |
| `signal_annual` | `STRIPE_PRICE_SIGNAL_ANNUAL` | |
| `assurance_monthly` | `STRIPE_PRICE_ASSURANCE_MONTHLY` | |
| `assurance_annual` | `STRIPE_PRICE_ASSURANCE_ANNUAL` | |
| `northstar_enterprise` | `STRIPE_PRICE_NORTHSTAR_ENTERPRISE` | optional; unset means contact / request access |

Amounts are never defined in code or HTML: they are read from the configured Stripe Price. An unset or unusable Price is shown as "not yet configured" / "currently unavailable". The client only sends `plan` + `interval`; Price IDs come from the server environment. Prices must be recurring, active, in the same mode as the API key, and (Signal/Assurance) have a 1-month / 1-year interval with count 1.

### Subscriber content readiness

The subscriber area (`/account/library`) is server-rendered and authorised on every request from the stored Stripe state and the clock. The catalogue (`src/subscriptions/content/catalog.json`) ships with **no items**: every area shows "Not yet published". Nothing premium is in public assets. Add items (slug, title, summary, body) to the catalogue only when real content is ready.

### Lifecycle

1. User requests a sign-in link (`POST /account/api/auth/request`); a 15-minute, single-use challenge is stored as a keyed HMAC hash and emailed. Opening the link shows a confirm button; submitting it (`POST /account/auth/verify`) creates an opaque session (cookie `__Host-cg_session` over HTTPS: HttpOnly, Secure, SameSite=Lax; 14-day absolute / 3-day idle; only its hash is stored).
2. State-changing calls require same-origin `Origin`, the session, and a CSRF token derived from the session.
3. Checkout (`POST /account/api/billing/checkout`) creates/reuses the Stripe Customer mapped to the signed-in user (created server-side, stored before use), then a hosted Checkout Session: `mode=subscription`, quantity 1, `client_reference_id` and metadata (`user_id`, `plan_key`, `billing_interval`, `environment`, `source`) set by the server, success/cancel URLs fixed under `APP_BASE_URL`. The success URL carries no session ID and grants nothing; the page asks the server to reconcile with Stripe.
4. Webhooks: raw-body signature verification, mode check and durable Redis enqueue (unchanged). The worker fetches canonical Stripe state, verifies customer→user linkage through the server-created mapping (metadata is only a cross-check), and writes `stripe_events` (idempotency), `subscriptions`, `entitlements` and `billing_audit` in one transaction before ACK.
5. Access = union of subscriptions where status is `active` (or `trialing` only if `SUBSCRIPTION_TRIAL_ACCESS=allow`; default deny), the verified `current_period_end` is in the future (plus optional `SUBSCRIPTION_ACCESS_GRACE_SECONDS`, max 86400, default 0), and the first invoice is not unpaid/void/uncollectible. `past_due`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`, `canceled` and deleted subscriptions are denied. `cancel_at_period_end` stays valid only until the period end. Because the period end is evaluated on every request, a missed webhook cannot extend access; a missed grant is repaired by "Refresh status from Stripe" (rate limited, scoped to the user's mapped customer).
6. Portal (`POST /account/api/billing/portal`) uses only the trusted mapped customer, including former subscribers.
7. Out-of-order events: each write carries the time its canonical state was fetched; older verifications cannot overwrite newer ones and terminal states (`canceled`, `incomplete_expired`) are never resurrected; a resubscription is a new Stripe subscription ID. Concurrent duplicates are serialised by the event-ID primary key.

### Schema (`migrations/001_subscriber_billing.sql`)

`users`, `auth_challenges`, `sessions`, `stripe_customers`, `subscriptions`, `entitlements`, `stripe_events`, `billing_audit`, `rate_limit_events`. Stored PII is the email address only; no card data is stored. Migrations are tracked in `schema_migrations` and are idempotent (`npm run migrate`). `clearglassinc-artemis/data/sql/0001_init.sql` remains an unconnected scaffold.

## Stripe Dashboard setup (test mode first)

1. Create products **Signal**, **Assurance** and (optionally) **Northstar** with recurring Prices: monthly and yearly for Signal/Assurance. Amounts are your decision; the code has none.
2. Copy each Price ID into the matching `STRIPE_PRICE_*` variable of the *same mode* as `STRIPE_SECRET_KEY`.
3. Configure the Customer Portal (Settings → Billing → Customer portal): enable payment-method updates, cancellation and (optionally) plan switching limited to the membership prices. Optionally set `STRIPE_PORTAL_CONFIGURATION_ID`.
4. Tax (optional): enable Stripe Tax, then set `STRIPE_AUTOMATIC_TAX=true`.
5. Webhook destination `https://<APP_HOST>/v1/webhooks/stripe` (use the real configured host) with events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.dispute.created`. `customer.updated` is not subscribed: no customer attributes other than the email supplied at creation are stored.
6. Keep test and live keys, Prices and webhook secrets strictly separate; the API and worker reject events whose mode differs from the key's mode.

## Environment

See `.env.example` for names (values must stay in the platform secret store). Required for membership: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, at least one Signal/Assurance `STRIPE_PRICE_*`, `APP_BASE_URL` (HTTPS in production), `SITE_BASE_URL`, `DATABASE_URL`, `AUTH_SECRET` (≥32 random characters), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`. If validation fails, `/account` returns 503, the public plan endpoint reports `configured:false`, and the logs list only the variable names at fault. The same variables must be present on the worker (see `render.yaml`).

## Local development

```bash
cd clearglassinc-artemis/apps/api-node
npm ci
npm run check
npm test                      # Postgres/Redis integration tests are skipped unless their URLs are set
# With a local Postgres and Redis:
export DATABASE_URL=postgres://USER@localhost:5432/artemis_dev   # your local, non-secret URL
export SUBSCRIPTIONS_PG_TEST_URL="$DATABASE_URL"
npm run migrate
npm test
# Forward test-mode webhooks (requires the Stripe CLI and test keys in your own shell):
stripe listen --forward-to localhost:8080/v1/webhooks/stripe
```

There is no auth bypass. To sign in locally, configure an SMTP catcher (for example a local MailHog/Mailpit on port 1025 with `SMTP_SECURE=false`) and read the emailed link there.

## Deploy on Render (`render.yaml`)

- Blueprint adds Postgres `clearglass-subscribers-db` (verify the plan name against current Render offerings before applying), injects `DATABASE_URL` into the API and worker, and runs `npm run migrate` as the API `preDeployCommand`.
- Set the `sync: false` variables in the Render dashboard. `APP_BASE_URL` is the public origin of the API service (the Render service URL, or a custom domain if you add one in Render and DNS; none is assumed here). `SITE_BASE_URL` defaults to the existing site origin.
- Deploys: the GitHub Actions workflow validates (tests, container build) and then triggers the API and worker deploy hooks for the exact commit. Postgres/Redis integration tests run in CI against service containers.
- Email: use any SMTP provider; set SPF/DKIM/DMARC for the `MAIL_FROM` domain at the provider.
- After deploy set `<meta name="clearglass-account-origin">` in `pricing.html` to the real `APP_BASE_URL` origin.

## Launch checklist

1. Test mode: all variables set, migration applied, webhook endpoint created, signing secret stored.
2. Sign in by email, subscribe with a Stripe test card, confirm the webhook reaches `billing_audit`, access appears, portal opens, cancel at period end, payment-failure test clock, deletion.
3. Repeat with live keys/Prices/webhook only after the above passes and a new live webhook signing secret is stored.
4. Only then update site copy and claim availability.

## Rollback

- Roll back the API/worker to the previous deploy in Render; the migration is additive (new tables only), so earlier code runs unchanged.
- To disable membership without a code rollback, unset `DATABASE_URL`/`AUTH_SECRET` on the API (accounts return 503; payments and webhook queueing keep working).
- Never drop `stripe_events`/`billing_audit` while Stripe may still retry events.

## Troubleshooting

- `/healthz` → `subscriptionsConfigured:false`: read the startup log line "Membership subscriptions disabled" (variable names only).
- Sign-in email never arrives: check SMTP variables and provider logs; the API returns 502 `email_delivery_failed` when SMTP rejects.
- Paid but no access: confirm the webhook delivery succeeded, the worker is running with `DATABASE_URL`, then use "Refresh status from Stripe". Inspect `billing_audit` for `subscription_unlinked` (customer not created by this system) or `subscription_linkage_mismatch`.
- Events in `billing.subscription.events.dead`: inspect the worker logs; fix the cause and re-queue manually.

## Known limitations

- Not exercised against real Stripe, SMTP or a deployed host; no real E2E has been performed.
- Subscriber content catalogue is empty by design.
- Worker with membership variables set (e.g. `DATABASE_URL`, `AUTH_SECRET`, `STRIPE_PRICE_*`) but an invalid membership configuration refuses to start (fail closed) so no subscription event is acknowledged without Postgres persistence; fix the configuration and restart. Legacy-only mode applies only when no membership variables are set or `SUBSCRIPTIONS_ENABLED=false`.
- Plan changes and cancellations are handled in the Stripe Customer Portal; multiple concurrent subscriptions are tolerated (union) but checkout blocks a second purchase while one is active.
- Rate limiting for the legacy endpoints stays in-memory; auth/checkout/portal limits are durable in Postgres.
