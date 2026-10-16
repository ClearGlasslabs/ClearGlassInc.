import { enqueueStripeEventOnce } from "./bus.js";

/**
 * Stripe webhook boundary helpers. Never verify parsed/re-serialized JSON.
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

  return stripeClient.webhooks.constructEvent(rawBody, signature, endpointSecret, tolerance);
}

/**
 * Dependency-injected route handler enables an HTTP-level test with official Stripe
 * signatures and a deterministic Redis stand-in, without needing production secrets.
 */
export function createStripeWebhookHandler({
  stripeClient,
  redisClient,
  getApiKey = () => process.env.STRIPE_SECRET_KEY,
  getEndpointSecret = () => process.env.STRIPE_WEBHOOK_SECRET,
  logger = console,
} = {}) {
  return async function stripeWebhookHandler(req, res) {
    if (!stripeClient) return res.status(503).json({ error: "stripe_not_configured" });

    const signature = req.headers["stripe-signature"];
    const webhookSecret = getEndpointSecret();
    if (!signature) return res.status(400).json({ error: "missing_stripe_signature" });
    if (!webhookSecret) return res.status(503).json({ error: "webhook_not_configured" });

    let event;
    try {
      event = verifyStripeEvent(stripeClient, req.body, signature, webhookSecret);
    } catch (error) {
      logger.warn("Stripe webhook verification failed", {
        errorType: error instanceof Error ? error.name : "Error",
      });
      return res.status(400).json({ error: "invalid_signature_or_payload" });
    }

    const apiKey = getApiKey() ?? "";
    const keyModeKnown = /^(?:sk|rk)_(?:test|live)_/.test(apiKey);
    if (!keyModeKnown) return res.status(503).json({ error: "stripe_key_mode_unconfigured" });

    const configuredLiveMode = /^(?:sk|rk)_live_/.test(apiKey);
    if (Boolean(event.livemode) !== configuredLiveMode) {
      return res.status(400).json({ error: "webhook_mode_mismatch" });
    }

    try {
      const enqueued = await enqueueStripeEventOnce(redisClient, event);
      if (!enqueued) return res.status(200).json({ received: true, duplicate: true });
    } catch (error) {
      logger.error("Stripe webhook durable enqueue failed", {
        errorType: error instanceof Error ? error.name : "Error",
      });
      return res.status(503).json({ error: "webhook_delivery_unavailable" });
    }

    return res.status(202).json({ received: true, queued: true });
  };
}
