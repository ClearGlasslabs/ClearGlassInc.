# Stripe Checkout deployment

This service creates hosted Stripe Checkout Sessions and verifies Stripe webhook signatures before publishing billing events.

## Required configuration

Set these values in the deployment platform's encrypted environment/secrets store:

- `STRIPE_SECRET_KEY`: restricted or secret API key for the intended Stripe account.
- `STRIPE_WEBHOOK_SECRET`: signing secret for the webhook endpoint.
- `STRIPE_ALLOWED_PRICE_IDS`: comma-separated allowlist of Stripe Price IDs.
- `STRIPE_CHECKOUT_MODE`: `payment` or `subscription`.
- `STRIPE_SUCCESS_URL`: HTTPS return URL after successful Checkout.
- `STRIPE_CANCEL_URL`: HTTPS return URL after cancellation.

Do not commit `sk_live_`, `rk_live_`, or `whsec_` values. The connected Stripe account is determined by the API key; the account ID is not used as authentication.

## Stripe Dashboard configuration

Create a webhook destination pointing to:

`https://YOUR_API_HOST/v1/webhooks/stripe`

Subscribe only to events the billing workflow consumes. Recommended starting events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Copy the endpoint signing secret into `STRIPE_WEBHOOK_SECRET`.

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

## Security controls implemented

- Stripe SDK signature verification over the exact raw body.
- Server-side Price ID allowlist.
- Quantity bounds.
- HTTPS enforcement for production redirects.
- Seven-day webhook idempotency window.
- Sanitized error responses and logs.
- Hosted Checkout so payment-card data does not traverse ClearGlass infrastructure.
