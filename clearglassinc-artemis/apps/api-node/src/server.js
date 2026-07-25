import express from "express";
import crypto from "node:crypto";
import Stripe from "stripe";
import { redis } from "./redis.js";
import { publish } from "./bus.js";

const app = express();
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

// Stripe requires the exact raw request body for signature verification.
app.post("/v1/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  if (!requireStripe(res)) return;

  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return res.status(400).json({ error: "missing_stripe_signature_or_secret" });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error) {
    console.warn("Stripe webhook verification failed", { message: error.message });
    return res.status(400).json({ error: "invalid_signature" });
  }

  const idemKey = `idem:stripe:${event.id}`;
  if (await redis.get(idemKey)) return res.status(200).json({ duplicate: true });

  await redis.set(idemKey, "1", "EX", 604800);
  await publish("billing.subscription.events", {
    provider: "stripe",
    event: {
      id: event.id,
      type: event.type,
      created: event.created,
      livemode: event.livemode,
      data: event.data,
    },
  });

  return res.status(202).json({ accepted: true });
});

// Hosted Checkout keeps card data off ClearGlass infrastructure.
app.post("/v1/billing/checkout-sessions", express.json({ limit: "16kb" }), async (req, res) => {
  if (!requireStripe(res)) return;

  const { priceId, quantity = 1, customerEmail, clientReferenceId } = req.body ?? {};
  const allowlist = allowedPriceIds();

  if (typeof priceId !== "string" || !allowlist.has(priceId)) {
    return res.status(400).json({ error: "invalid_or_unapproved_price" });
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 25) {
    return res.status(400).json({ error: "invalid_quantity" });
  }
  if (customerEmail !== undefined && typeof customerEmail !== "string") {
    return res.status(400).json({ error: "invalid_customer_email" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: process.env.STRIPE_CHECKOUT_MODE === "subscription" ? "subscription" : "payment",
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

// Gumroad remains separate; do not treat its signature as Stripe-compatible.
app.post("/v1/webhooks/gumroad", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["gumroad-signature"];
  if (!signature) return res.status(400).send("missing signature");

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
app.post("/v1/events/ingest", express.json(), async (req, res) => {
  const id = req.body.id ?? crypto.randomUUID();
  await publish("intel.raw.events", { ...req.body, id });
  res.status(202).json({ accepted: true, id });
});

// --- Approval gates (stubs) ------------------------------------------------
app.post("/v1/actions/:id/approve", express.json(), async (req, res) => {
  await publish("intel.case.actions", { action_id: req.params.id, decision: "approved", actor: req.body.actor });
  res.json({ ok: true });
});
app.post("/v1/actions/:id/reject", express.json(), async (req, res) => {
  await publish("intel.case.actions", { action_id: req.params.id, decision: "rejected", actor: req.body.actor });
  res.json({ ok: true });
});

app.get("/healthz", (_req, res) => res.json({ ok: true, stripeConfigured: Boolean(stripe) }));

const port = process.env.PORT ?? 8080;
app.listen(port, () => console.log(`api-node listening on :${port}`));

export { app, allowedPriceIds, safeCheckoutUrl };
