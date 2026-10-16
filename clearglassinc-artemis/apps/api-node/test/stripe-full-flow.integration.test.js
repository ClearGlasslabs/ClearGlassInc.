import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import Redis from "ioredis";
import Stripe from "stripe";
import test from "node:test";
import { createStripeWebhookHandler } from "../src/stripe-webhook.js";
import { processEntry } from "../src/stripe-worker.js";

const API_KEY = "sk_test_ci_end_to_end_only";
const ENDPOINT_SECRET = "whsec_ci_end_to_end_only";
const STREAM = "billing.subscription.events";
const GROUP = "billing-consumer-v1";
const CONSUMER = "stripe-e2e-ci";
const now = Math.floor(Date.now() / 1000);
const stripeForSignatureVerification = new Stripe(API_KEY);

function sign(rawBody, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = crypto.createHmac("sha256", ENDPOINT_SECRET)
    .update(Buffer.concat([Buffer.from(String(timestamp) + ".", "utf8"), rawBody]))
    .digest("hex");
  return "t=" + timestamp + ",v1=" + digest;
}

function serializeEvent(id, type, object) {
  return Buffer.from(JSON.stringify({
    id,
    object: "event",
    api_version: "2024-06-20",
    created: now,
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
  }), "utf8");
}

function fieldsToObject(fields) {
  const result = {};
  for (let i = 0; i < fields.length; i += 2) result[fields[i]] = fields[i + 1];
  return result;
}

function fakeStripeApi() {
  return {
    invoices: {
      retrieve: async (id) => {
        const failed = id === "in_e2e_failed";
        return {
          id,
          status: failed ? "open" : "paid",
          customer: "cus_e2e_clear",
          subscription: failed ? "sub_e2e_past_due" : "sub_e2e_paid",
          amount_due: 2000,
          amount_paid: failed ? 0 : 2000,
          amount_remaining: failed ? 2000 : 0,
          currency: "cad",
          attempt_count: failed ? 2 : 1,
        };
      },
    },
    subscriptions: {
      retrieve: async (id) => ({
        id,
        customer: "cus_e2e_clear",
        status: id === "sub_e2e_past_due" ? "past_due" : "active",
        items: { data: [{
          price: { id: "price_e2e_test" },
          current_period_start: now - 60,
          current_period_end: now + 86400,
        }] },
        current_period_start: now - 60,
        current_period_end: now + 86400,
        cancel_at_period_end: false,
      }),
    },
    charges: {
      retrieve: async (id) => ({
        id,
        customer: "cus_e2e_clear",
        payment_intent: "pi_e2e_clear",
        currency: "cad",
      }),
    },
  };
}

function buildEvents() {
  return [
    {
      id: "evt_e2e_paid",
      type: "invoice.paid",
      object: { id: "in_e2e_paid" },
      verify: async (redis) => {
        const invoice = JSON.parse(await redis.get("billing:stripe:invoice:in_e2e_paid"));
        const subscription = JSON.parse(await redis.get("billing:stripe:subscription:sub_e2e_paid"));
        assert.equal(invoice.paymentOutcome, "paid");
        assert.equal(invoice.amountPaid, 2000);
        assert.equal(subscription.status, "active");
      },
    },
    {
      id: "evt_e2e_failed",
      type: "invoice.payment_failed",
      object: { id: "in_e2e_failed" },
      verify: async (redis) => {
        const invoice = JSON.parse(await redis.get("billing:stripe:invoice:in_e2e_failed"));
        const subscription = JSON.parse(await redis.get("billing:stripe:subscription:sub_e2e_past_due"));
        assert.equal(invoice.paymentOutcome, "payment_failed");
        assert.equal(subscription.status, "past_due");
        assert.notEqual(subscription.status, "canceled");
      },
    },
    {
      id: "evt_e2e_cancelled",
      type: "customer.subscription.deleted",
      object: {
        id: "sub_e2e_cancelled",
        object: "subscription",
        customer: "cus_e2e_clear",
        status: "canceled",
        canceled_at: now,
        ended_at: now,
        items: { data: [{ price: { id: "price_e2e_test" }, current_period_end: now + 86400 }] },
      },
      verify: async (redis) => {
        const subscription = JSON.parse(await redis.get("billing:stripe:subscription:sub_e2e_cancelled"));
        assert.equal(subscription.status, "canceled");
      },
    },
    {
      id: "evt_e2e_dispute",
      type: "charge.dispute.created",
      object: {
        id: "dp_e2e_clear",
        customer: "cus_e2e_clear",
        charge: "ch_e2e_clear",
        payment_intent: "pi_e2e_clear",
        status: "needs_response",
        reason: "fraudulent",
        currency: "cad",
        amount: 2000,
        evidence_details: { due_by: now + 86400 },
      },
      verify: async (redis) => {
        const dispute = JSON.parse(await redis.get("billing:stripe:dispute:dp_e2e_clear"));
        const customerRisk = JSON.parse(await redis.get("billing:stripe:customer-risk:cus_e2e_clear"));
        assert.equal(dispute.reviewRequired, true);
        assert.equal(dispute.paymentIntentId, "pi_e2e_clear");
        assert.equal(customerRisk.disputeReviewRequired, true);
      },
    },
  ];
}

test("signed HTTP delivery through real Redis and worker processes paid, failed, cancellation, and dispute events once", {
  skip: process.env.STRIPE_E2E_INTEGRATION_TESTS !== "true",
}, async () => {
  const redisUrl = process.env.STRIPE_E2E_REDIS_URL;
  assert.ok(redisUrl, "STRIPE_E2E_REDIS_URL is required when end-to-end integration is enabled");
  const parsedUrl = new URL(redisUrl);
  assert.ok(["localhost", "127.0.0.1", "redis"].includes(parsedUrl.hostname),
    "End-to-end Redis tests may only target a local CI Redis service");
  assert.equal(parsedUrl.port || "6379", "6379");
  assert.equal(parsedUrl.pathname, "/14", "End-to-end Redis tests are isolated to database 14");

  const redis = new Redis(redisUrl, { connectTimeout: 3000, maxRetriesPerRequest: 1 });
  const oldKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = API_KEY;
  let server;
  try {
    await redis.ping();
    await redis.flushdb();
    await redis.xgroup("CREATE", STREAM, GROUP, "0-0", "MKSTREAM");

    const app = express();
    app.post(
      "/v1/webhooks/stripe",
      express.raw({ type: "application/json", limit: "2mb" }),
      createStripeWebhookHandler({
        stripeClient: stripeForSignatureVerification,
        redisClient: redis,
        getApiKey: () => API_KEY,
        getEndpointSecret: () => ENDPOINT_SECRET,
        logger: { warn() {}, error() {} },
      }),
    );
    server = await new Promise((resolve) => {
      const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate));
    });
    const url = "http://127.0.0.1:" + server.address().port + "/v1/webhooks/stripe";
    const events = buildEvents();

    for (const item of events) {
      const raw = serializeEvent(item.id, item.type, item.object);
      const headers = { "content-type": "application/json", "stripe-signature": sign(raw) };
      const accepted = await fetch(url, { method: "POST", headers, body: raw });
      assert.equal(accepted.status, 202, item.type);
      assert.deepEqual(await accepted.json(), { received: true, queued: true });

      const duplicate = await fetch(url, { method: "POST", headers, body: raw });
      assert.equal(duplicate.status, 200, item.type + " duplicate");
      assert.deepEqual(await duplicate.json(), { received: true, duplicate: true });
    }

    const streamRows = await redis.xrange(STREAM, "-", "+");
    assert.equal(streamRows.length, events.length, "only one durable queue row per event ID");

    const response = await redis.xreadgroup(
      "GROUP", GROUP, CONSUMER,
      "COUNT", String(events.length),
      "STREAMS", STREAM, ">",
    );
    assert.equal(response[0][1].length, events.length);

    const stripeApi = fakeStripeApi();
    const eventById = new Map(events.map((item) => [item.id, item]));
    for (const [streamId, fields] of response[0][1]) {
      const values = fieldsToObject(fields);
      assert.ok(eventById.has(values.event_id), "consumer received an expected event");
      await processEntry(redis, stripeApi, streamId, fields);
    }

    for (const item of events) await item.verify(redis);
    const pending = await redis.xpending(STREAM, GROUP);
    assert.equal(pending[0], 0, "consumer must acknowledge every successfully processed test event");
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await redis.flushdb();
    await redis.quit();
    if (oldKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = oldKey;
  }
});
