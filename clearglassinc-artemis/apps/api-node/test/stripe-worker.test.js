import assert from "node:assert/strict";
import test from "node:test";
import { processEntry } from "../src/stripe-worker.js";

const now = Math.floor(Date.now() / 1000);

function makeEvent(id, type, object) {
  return {
    id,
    type,
    created: now,
    livemode: false,
    data: { object },
  };
}

function fields(event) {
  return [
    "provider", "stripe",
    "event_id", event.id,
    "event_type", event.type,
    "livemode", "false",
    "payload", JSON.stringify(event),
    "received_at", new Date().toISOString(),
  ];
}

function fakeStripe({ invoiceStatus = "paid", subscriptionStatus = "active", failInvoice = false } = {}) {
  return {
    invoices: {
      retrieve: async (id) => {
        if (failInvoice) throw new Error("simulated Stripe read failure");
        return {
          id,
          status: invoiceStatus,
          customer: "cus_worker_test",
          subscription: "sub_worker_test",
          currency: "cad",
          amount_due: 2000,
          amount_paid: invoiceStatus === "paid" ? 2000 : 0,
          amount_remaining: invoiceStatus === "paid" ? 0 : 2000,
          attempt_count: 1,
        };
      },
    },
    subscriptions: {
      retrieve: async (id) => ({
        id,
        customer: "cus_worker_test",
        status: subscriptionStatus,
        items: { data: [{ price: { id: "price_approved_test" }, current_period_start: now - 60, current_period_end: now + 86400 }] },
        current_period_start: now - 60,
        current_period_end: now + 86400,
      }),
    },
  };
}

function fakeRedis({ evalResults = [1], attempts = 1 } = {}) {
  const calls = { eval: [], ack: [], del: [], incr: [], expire: [] };
  return {
    calls,
    async eval(...args) {
      calls.eval.push(args);
      return evalResults.length ? evalResults.shift() : 1;
    },
    async xack(...args) { calls.ack.push(args); return 1; },
    async del(...args) { calls.del.push(args); return 1; },
    async incr(...args) { calls.incr.push(args); return attempts; },
    async expire(...args) { calls.expire.push(args); return 1; },
  };
}

test("stream worker applies invoice-paid state atomically before acknowledging", async () => {
  const previousKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_worker_unit_test_only";
  try {
    const event = makeEvent("evt_worker_invoice_paid", "invoice.paid", { id: "in_worker_paid" });
    const redis = fakeRedis();
    await processEntry(redis, fakeStripe(), "1710000000000-0", fields(event));

    assert.equal(redis.calls.eval.length, 1);
    assert.match(redis.calls.eval[0][0], /EXISTS/);
    assert.match(redis.calls.eval[0][0], /SET/);
    assert.deepEqual(redis.calls.ack, [["billing.subscription.events", "billing-consumer-v1", "1710000000000-0"]]);
    assert.deepEqual(redis.calls.del, [["stripe:consumer:attempts:1710000000000-0"]]);
  } finally {
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
  }
});

test("stream worker records failed payment without marking subscription canceled", async () => {
  const previousKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_worker_unit_test_only";
  try {
    const event = makeEvent("evt_worker_invoice_failed", "invoice.payment_failed", { id: "in_worker_failed" });
    const redis = fakeRedis();
    await processEntry(redis, fakeStripe({ invoiceStatus: "open", subscriptionStatus: "past_due" }), "1710000000001-0", fields(event));

    const serializedInvoice = redis.calls.eval[0].at(-5);
    const invoiceRecord = JSON.parse(serializedInvoice);
    assert.equal(invoiceRecord.paymentOutcome, "payment_failed");
    // Subscription is a second record in this same atomic Lua transaction.
    const serializedSubscription = redis.calls.eval[0].at(-1);
    assert.equal(JSON.parse(serializedSubscription).status, "past_due");
    assert.deepEqual(redis.calls.ack, [["billing.subscription.events", "billing-consumer-v1", "1710000000001-0"]]);
  } finally {
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
  }
});

test("stream worker retries errors and atomically dead-letters after max attempts", async () => {
  const previousKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_worker_unit_test_only";
  try {
    const event = makeEvent("evt_worker_retry", "invoice.paid", { id: "in_retry" });
    const redis = fakeRedis({ attempts: 5 });
    await processEntry(redis, fakeStripe({ failInvoice: true }), "1710000000002-0", fields(event));

    assert.deepEqual(redis.calls.incr, [["stripe:consumer:attempts:1710000000002-0"]]);
    assert.deepEqual(redis.calls.expire, [["stripe:consumer:attempts:1710000000002-0", 604800]]);
    assert.equal(redis.calls.eval.length, 1);
    assert.match(redis.calls.eval[0][0], /DEAD LETTER|billing\.subscription\.events\.dead|dead/i);
    assert.equal(redis.calls.eval[0][1], 3);
    assert.equal(redis.calls.eval[0][2], "billing.subscription.events");
    assert.equal(redis.calls.eval[0][3], "billing.subscription.events.dead");
  } finally {
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
  }
});
