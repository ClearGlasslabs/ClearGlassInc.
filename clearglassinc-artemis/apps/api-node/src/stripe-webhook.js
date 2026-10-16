/**
 * Stripe webhook boundary helpers.
 *
 * All request signature checks use the Stripe SDK over the original Buffer.
 * The API route supplies express.raw() output directly; this module deliberately
 * refuses strings so parsed/re-serialized JSON cannot accidentally be verified.
 */
export function verifyStripeEvent(stripeClient, rawBody, signature, endpointSecret, tolerance = 300) {
  if (!Buffer.isBuffer(rawBody)) {
    throw new TypeError("Stripe webhook payload must be the original raw Buffer");
  }
  if (typeof signature !== "string" || !signature) {
    throw new TypeError("Stripe-Signature header is required");
  }
  if (typeof endpointSecret !== "string" || !endpointSecret) {
    throw new TypeError("Stripe webhook signing secret is required");
  }
  if (!stripeClient?.webhooks || typeof stripeClient.webhooks.constructEvent !== "function") {
    throw new TypeError("Stripe SDK webhook verifier is unavailable");
  }

  // Stripe SDK validates HMAC-SHA256, supported v1 signatures, and timestamp tolerance.
  return stripeClient.webhooks.constructEvent(rawBody, signature, endpointSecret, tolerance);
}
