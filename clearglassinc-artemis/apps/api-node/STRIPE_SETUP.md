# Stripe Checkout deployment

This service creates hosted Stripe Checkout Sessions and verifies Stripe webhook signatures before atomically accepting events into the Redis Stream `billing.subscription.events`. Queue acceptance is not itself payment fulfillment or entitlement activation.

## Required configuration

Set these values in the deployment platform's encrypted environment/secrets store:

- `STRIPE_SECRET_KEY`: restricted or secret API key for the intended Stripe account; configure the same mode/account key in both the API and worker services.
- `STRIPE_WEBHOOK_SECRET`: signing secret for this exact webhook endpoint, on the API service only.
- `STRIPE_ALLOWED_PRICE_IDS`: comma-separated allowlist of Stripe Price IDs.
- `STRIPE_CHECKOUT_MODE`: `payment` or `subscription`.
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

Redirect the browser to `url`. Never collect card numbers directly in this API.

## GitHub Actions secrets

GitHub Actions secrets are only needed when a workflow deploys the application. Add secrets at the environment or repository level and map them into the deployment job. Do not expose Stripe secrets to pull-request workflows from forks, build logs, client-side bundles, or static GitHub Pages.

## Webhook delivery and release gates

- The route uses `express.raw({ type: "application/json" })` before any JSON parsing and passes the original Buffer to Stripe's official SDK. The SDK checks the signature and timestamp tolerance.
- Test/live event mode must match the configured Stripe API key mode.
- A Redis Lua script atomically checks the seven-day event-ID idempotency key and appends the verified event to the `billing.subscription.events` Redis Stream.
- The separate `clearglass-stripe-worker` service consumes the stream with a Redis consumer group, reclaims abandoned entries, retries failures, and moves poison events to `billing.subscription.events.dead` after five failed attempts.
- A second Redis Lua script atomically writes a one-year processed-event marker and the corresponding billing ledger records. Replayed events do not reapply those ledger effects; older state snapshots cannot overwrite newer records.
- The consumer maintains checkout, invoice, subscription-lifecycle, dispute, and customer-risk ledger records. Failed invoice payments are recorded without fabricating cancellation. Disputes are flagged for review and do not automatically refund payments or revoke all access.
- A verified duplicate returns HTTP 200. Missing server configuration or Redis enqueue failures return non-2xx so Stripe retries. Invalid signatures return HTTP 400.
- The billing ledger deliberately remains `billingAccessState: "unlinked"`: there is no authenticated application-user-to-Stripe-customer mapping in this repository. This worker therefore does **not** grant or revoke premium entitlements or claim fulfillment. That separate identity/authorization model and an end-to-end signed test-mode run are release gates.
- CI runs the enqueue/idempotency Lua scripts against an isolated local Redis database 15. Test-mode endpoint delivery is still separate from CI and must be proven against the deployed host before the live endpoint is created.
- Do not log signing secrets, signature values, raw request bodies, or full Stripe events.
- Server-side Price ID allowlist, quantity bounds, HTTPS enforcement for production redirects, and hosted Checkout remain in place so card data does not traverse ClearGlass infrastructure.
