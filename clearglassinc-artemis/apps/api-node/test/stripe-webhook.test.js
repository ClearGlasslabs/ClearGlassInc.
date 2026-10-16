import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import Stripe from "stripe";
import { enqueueStripeEventOnce } from "../src/bus.js";
import { verifyStripeEvent } from "../src/stripe-webhook.js";

const stripe = new Stripe("sk_test_webhook_unit_tests_only");
const endpointSecret = "whsec_webhook_unit_tests_only";

function sign(rawBody, secret = endpointSecret, timestamp = Math.floor(Date.now() / 1000)) {
  const timestampBytes = Buffer.from(`${timestamp}.`, "utf8");
  const digest = crypto
    .createHmac("sha256", secret)
    .update(Buffer.concat([timestampBytes, rawBody]))
    .digest("hex");
  return { timestamp, signature: `t=${timestamp},v1=${digest}` };
}

function payload() {
  // Deliberately noncanonical whitespace: verification must use these exact bytes.
  return Buffer.from(
    '{\n  "id": "evt_raw_body_test",\n  "type": "checkout.session.completed",\n' +
    '  "created": 1792166400,\n  "livemode": false,\n  "data": {"object": {"id": "cs_test_1"}}\n}\n',
    "utf8",
  );
}

test("Stripe SDK verifies original raw bytes and rejects JSON reserialization", () => {
  const rawBody = payload();
  const { signature } = sign(rawBody);

  const verified = verifyStripeEvent(stripe, rawBody, signature, endpointSecret);
  assert.equal(verified.id, "evt_raw_body_test");

  const reserialized = Buffer.from(JSON.stringify(JSON.parse(rawBody.toString("utf8"))), "utf8");
  assert.throws(() => verifyStripeEvent(stripe, reserialized, signature, endpointSecret));
});

test("Stripe SDK accepts any valid v1 signature during endpoint-secret rotation", () => {
  const rawBody = payload();
  const { timestamp, signature } = sign(rawBody);
  const goodV1 = signature.split("v1=")[1];
  const header = `t=${timestamp},v1=${"0".repeat(64)},v1=${goodV1}`;

  const verified = verifyStripeEvent(stripe, rawBody, header, endpointSecret);
  assert.equal(verified.id, "evt_raw_body_test");
});

test("Stripe SDK rejects signatures outside the default five-minute tolerance", () => {
  const rawBody = payload();
  const { signature } = sign(rawBody, endpointSecret, Math.floor(Date.now() / 1000) - 600);
  assert.throws(() => verifyStripeEvent(stripe, rawBody, signature, endpointSecret));
});

test("verification helper refuses a string that could be parsed and reserialized JSON", () => {
  assert.throws(
    () => verifyStripeEvent(stripe, payload().toString("utf8"), sign(payload()).signature, endpointSecret),
    /raw Buffer/,
  );
});

test("Stripe event queue uses one atomic Redis script for dedupe and append", async () => {
  const calls = [];
  const redisClient = {
    async eval(...args) {
      calls.push(args);
      return 1;
    },
  };
  const event = {
    id: "evt_atomic_queue_test",
    type: "invoice.paid",
    created: 1792166400,
    livemode: false,
    data: { object: { id: "in_test_1" } },
  };

  assert.equal(await enqueueStripeEventOnce(redisClient, event), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 2);
  assert.equal(calls[0][2], "idem:stripe:evt_atomic_queue_test");
  assert.equal(calls[0][3], "billing.subscription.events");
  assert.match(calls[0][0], /XADD/);
  assert.match(calls[0][0], /SET/);
  assert.match(calls[0][0], /if existing then return 0 end/);
  assert.equal(JSON.parse(calls[0][7]).id, event.id);
  assert.equal(JSON.parse(calls[0][7]).type, event.type);
});

test("duplicate event id returns duplicate without writing a second queue entry", async () => {
  const redisClient = { async eval() { return 0; } };
  const event = {
    id: "evt_duplicate_test",
    type: "customer.subscription.deleted",
    livemode: true,
    data: { object: { id: "sub_test_1" } },
  };

  assert.equal(await enqueueStripeEventOnce(redisClient, event), false);
});
