import express from "express";
import crypto from "node:crypto";
import Stripe from "stripe";
import { redis } from "./redis.js";
import { publish } from "./bus.js";
import { createStripeWebhookHandler } from "./stripe-webhook.js";
import { isApprovedCheckoutPrice, resolveCheckoutMode } from "./billing-config.js";
import { loadSubscriptionConfig } from "./subscriptions/config.js";
import { createDb } from "./subscriptions/db.js";
import { createMailer } from "./subscriptions/mail.js";
import { createSubscriptionRouter } from "./subscriptions/routes.js";
import { rateLimit, requireRole, requireTrustedOrigin, securityHeaders, validEmail, validIdentifier, verifyHmac } from "./security.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(securityHeaders);
app.use(rateLimit({ limit: 120 }));

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

function requireStripe(res) {
  if (stripe) return true;
  res.status(503).json({ error: "stripe_not_configured" });
  return false;
}

function allowedPriceIds() {
  return new Set(
    (process.env.STRIPE_ALLOWED_PRICE_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function safeCheckoutUrl(value, fallback) {
  const candidate = value ?? fallback;
  const url = new URL(candidate);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) {
    throw new Error("Checkout redirect URLs must use HTTPS outside localhost");
  }
  return url.toString();
}

const subscriptionConfig = loadSubscriptionConfig();
if (!subscriptionConfig.ok && process.env.NODE_ENV !== "test") {
  // Variable names only; the membership area stays disabled (503) until fully configured.
  console.warn("Membership subscriptions disabled", { problems: subscriptionConfig.errors });
}

function membershipPriceIds() {
  return new Set([...subscriptionConfig.priceMap.keys()]);
}

// Stripe requires the exact raw request body for signature verification.
app.post("/v1/webhooks/stripe", express.raw({ type: "application/json", limit: "2mb" }), createStripeWebhookHandler({
  stripeClient: stripe,
  redisClient: redis,
}));

// Hosted Checkout keeps card data off ClearGlass infrastructure.
app.post("/v1/billing/checkout-sessions", requireTrustedOrigin, rateLimit({ limit: 10 }), express.json({ limit: "16kb" }), async (req, res) => {
  if (!requireStripe(res)) return;

  const { priceId, quantity = 1, customerEmail, clientReferenceId } = req.body ?? {};
  const allowlist = allowedPriceIds();

  if (typeof priceId !== "string" || !allowlist.has(priceId)) {
    return res.status(400).json({ error: "invalid_or_unapproved_price" });
  }
  if (membershipPriceIds().has(priceId)) {
    // Membership subscriptions must start from an authenticated account so they map to a trusted user.
    return res.status(400).json({ error: "membership_requires_account" });
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 25) {
    return res.status(400).json({ error: "invalid_quantity" });
  }
  if (customerEmail !== undefined && !validEmail(customerEmail)) {
    return res.status(400).json({ error: "invalid_customer_email" });
  }

  try {
    const price = await stripe.prices.retrieve(priceId);
    if (!isApprovedCheckoutPrice(price, priceId, allowlist, process.env.STRIPE_SECRET_KEY)) {
      return res.status(400).json({ error: "invalid_or_unapproved_price" });
    }
    const mode = resolveCheckoutMode(price);
    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity }],
      customer_email: customerEmail,
      client_reference_id:
        typeof clientReferenceId === "string" ? clientReferenceId.slice(0, 200) : undefined,
      success_url: safeCheckoutUrl(
        process.env.STRIPE_SUCCESS_URL,
        "http://localhost:3000/payment/success?session_id={CHECKOUT_SESSION_ID}"
      ),
      cancel_url: safeCheckoutUrl(
        process.env.STRIPE_CANCEL_URL,
        "http://localhost:3000/payment/cancelled"
      ),
      metadata: {
        source: "clearglassinc-artemis",
        request_id: crypto.randomUUID(),
      },
    });

    return res.status(201).json({ id: session.id, url: session.url });
  } catch (error) {
    console.error("Stripe Checkout session creation failed", {
      type: error.type,
      code: error.code,
      requestId: error.requestId,
    });
    return res.status(502).json({ error: "checkout_session_failed" });
  }
});

// Subscriber accounts, membership checkout/portal and protected content (same-origin backend).
app.use(createSubscriptionRouter({
  db: subscriptionConfig.ok ? createDb(process.env.DATABASE_URL) : null,
  stripe,
  mailer: subscriptionConfig.ok ? createMailer(subscriptionConfig.smtp) : null,
  ctx: subscriptionConfig,
}));

// Gumroad remains separate; do not treat its signature as Stripe-compatible.
app.post("/v1/webhooks/gumroad", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["gumroad-signature"];
  if (!verifyHmac(req.body, signature, process.env.GUMROAD_WEBHOOK_SECRET)) return res.status(400).send("invalid signature");

  let event;
  try {
    event = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).send("bad payload");
  }

  const idemKey = `idem:gumroad:${event.id}`;
  if (await redis.get(idemKey)) return res.status(200).send("duplicate");
  await redis.set(idemKey, "1", "EX", 86400);
  await publish("billing.subscription.events", { provider: "gumroad", event });
  return res.status(202).send("accepted");
});

// --- Event ingest ----------------------------------------------------------
app.post("/v1/events/ingest", requireRole("ingest"), rateLimit({ limit: 30 }), express.json({ limit: "64kb", strict: true }), async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ error: "invalid_event" });
  const id = req.body.id ?? crypto.randomUUID();
  if (!validIdentifier(id)) return res.status(400).json({ error: "invalid_event_id" });
  await publish("intel.raw.events", { ...req.body, id });
  res.status(202).json({ accepted: true, id });
});

// --- Approval gates (stubs) ------------------------------------------------
app.post("/v1/actions/:id/approve", requireRole("operator"), express.json({ limit: "4kb" }), async (req, res) => {
  if (!validIdentifier(req.params.id)) return res.status(400).json({ error: "invalid_action_id" });
  await publish("intel.case.actions", { action_id: req.params.id, decision: "approved", actor: req.auth.actor });
  res.json({ ok: true });
});
app.post("/v1/actions/:id/reject", requireRole("operator"), express.json({ limit: "4kb" }), async (req, res) => {
  if (!validIdentifier(req.params.id)) return res.status(400).json({ error: "invalid_action_id" });
  await publish("intel.case.actions", { action_id: req.params.id, decision: "rejected", actor: req.auth.actor });
  res.json({ ok: true });
});

app.get("/healthz", (_req, res) => res.json({ ok: true, stripeConfigured: Boolean(stripe), subscriptionsConfigured: subscriptionConfig.ok }));

const port = process.env.PORT ?? 8080;
if (process.env.NODE_ENV !== "test") app.listen(port, () => console.log(`api-node listening on :${port}`));

export { app, allowedPriceIds, safeCheckoutUrl };
