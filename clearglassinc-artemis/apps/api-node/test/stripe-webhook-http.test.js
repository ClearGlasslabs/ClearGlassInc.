import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import test from "node:test";
import Stripe from "stripe";
import { createStripeWebhookHandler } from "../src/stripe-webhook.js";

const API_KEY = "sk_test_webhook_http_tests_only";
const ENDPOINT_SECRET = "whsec_webhook_http_tests_only";
const stripe = new Stripe(API_KEY);
const quietLogger = { warn() {}, error() {} };

function makeEvent(id = "evt_http_duplicate", livemode = false) {
  return Buffer.from(JSON.stringify({
    id,
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: "cs_test_http_1", object: "checkout.session", payment_status: "paid" } },
    livemode,
    pending_webhooks: 1,
    request: null,
    type: "checkout.session.completed",
  }), "utf8");
}

function sign(rawBody, secret = ENDPOINT_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = crypto.createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(String(timestamp) + ".", "utf8"), rawBody]))
    .digest("hex");
  return "t=" + timestamp + ",v1=" + digest;
}

async function withWebhookServer(redisClient, callback, options = {}) {
  const app = express();
  app.post(
    "/v1/webhooks/stripe",
    express.raw({ type: "application/json", limit: "2mb" }),
    createStripeWebhookHandler({
      stripeClient: stripe,
      redisClient,
      getApiKey: () => options.apiKey ?? API_KEY,
      getEndpointSecret: () => options.endpointSecret ?? ENDPOINT_SECRET,
      logger: quietLogger,
    }),
  );
  const server = await new Promise((resolve) => {
    const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate));
  });
  try {
    const address = server.address();
    await callback("http://127.0.0.1:" + address.port + "/v1/webhooks/stripe");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function fakeRedis({ fail = false } = {}) {
  const seen = new Set();
  const queued = [];
  return {
    seen,
    queued,
    async eval(...args) {
      if (fail) throw new Error("simulated redis unavailable");
      const eventId = args[4];
      if (seen.has(eventId)) return 0;
      seen.add(eventId);
      queued.push(JSON.parse(args[7]));
      return 1;
    },
  };
}

test("actual HTTP handler accepts a correctly signed test-mode raw request exactly once", async () => {
  const redis = fakeRedis();
  const body = makeEvent("evt_http_duplicate", false);
  const signature = sign(body);
  await withWebhookServer(redis, async (url) => {
    const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body });
    assert.equal(first.status, 202);
    assert.deepEqual(await first.json(), { received: true, queued: true });

    const duplicate = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body });
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await duplicate.json(), { received: true, duplicate: true });
  });
  assert.equal(redis.queued.length, 1);
  assert.equal(redis.queued[0].id, "evt_http_duplicate");
  assert.equal(redis.queued[0].livemode, false);
});

test("HTTP handler rejects tampered bytes and missing signatures", async () => {
  const redis = fakeRedis();
  const body = makeEvent("evt_tampered", false);
  await withWebhookServer(redis, async (url) => {
    const bad = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": sign(body) },
      body: Buffer.concat([body, Buffer.from(" ", "utf8")]),
    });
    assert.equal(bad.status, 400);

    const missing = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(missing.status, 400);
  });
  assert.equal(redis.queued.length, 0);
});

test("HTTP handler rejects test/live mode mismatch", async () => {
  const redis = fakeRedis();
  const body = makeEvent("evt_wrong_mode", true);
  await withWebhookServer(redis, async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": sign(body) },
      body,
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "webhook_mode_mismatch" });
  });
  assert.equal(redis.queued.length, 0);
});

test("HTTP handler returns retryable 503 when durable Redis enqueue fails", async () => {
  const redis = fakeRedis({ fail: true });
  const body = makeEvent("evt_redis_unavailable", false);
  await withWebhookServer(redis, async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": sign(body) },
      body,
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "webhook_delivery_unavailable" });
  });
});

test("HTTP handler fails closed when the endpoint signing secret is absent", async () => {
  const redis = fakeRedis();
  const body = makeEvent("evt_missing_secret", false);
  await withWebhookServer(redis, async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": sign(body) },
      body,
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "webhook_not_configured" });
  }, { endpointSecret: "" });
  assert.equal(redis.queued.length, 0);
});
