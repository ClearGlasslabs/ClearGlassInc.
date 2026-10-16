import assert from "node:assert/strict";
import test from "node:test";
import {
  STRIPE_BILLING_EVENT_TYPES,
  applyStripeBillingEffects,
  buildStripeBillingEffects,
} from "../src/stripe-consumer.js";

const now = Math.floor(Date.now() / 1000);
function event(id, type, object, created = now) {
  return {
    id,
    type,
    created,
    livemode: false,
    data: { object },
  };
}
function subscription(id = "sub_test_1", overrides = {}) {
  return {
    id,
    object: "subscription",
    customer: "cus_test_1",
    status: "active",
    items: { data: [{ id: "si_1", price: { id: "price_approved_1" }, current_period_start: now - 3600, current_period_end: now + 86400 }] },
    current_period_start: now - 3600,
    current_period_end: now + 86400,
    cancel_at_period_end: false,
    ...overrides,
  };
}
function fakeStripe({ currentSubscription, currentInvoice, session, charge } = {}) {
  return {
    subscriptions: { retrieve: async (id) => currentSubscription ?? subscription(id) },
    invoices: { retrieve: async (id) => currentInvoice ?? ({ id, status: "open", customer: "cus_test_1", subscription: "sub_test_1", amount_due: 1200, amount_paid: 0, amount_remaining: 1200, currency: "cad" }) },
    checkout: { sessions: { retrieve: async (id) => session ?? ({ id, status: "complete", payment_status: "paid", mode: "subscription", customer: "cus_test_1", subscription: "sub_test_1", amount_total: 1200, currency: "cad", client_reference_id: "user-controlled-value" }) } },
    charges: { retrieve: async (id) => charge ?? ({ id, customer: "cus_test_1", payment_intent: "pi_test_1", currency: "cad" }) },
  };
}

test("consumer handles the documented billing event set including subscription update events", () => {
  for (const type of [
    "checkout.session.completed",
    "invoice.paid",
    "invoice.payment_failed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "charge.dispute.created",
  ]) assert.ok(STRIPE_BILLING_EVENT_TYPES.includes(type), type);
});

test("checkout completion records payment and subscription but never grants unlinked access", async () => {
  const stripe = fakeStripe();
  const effects = await buildStripeBillingEffects(
    event("evt_checkout", "checkout.session.completed", { id: "cs_test_1" }),
    stripe,
  );
  const checkout = effects.records.find((record) => record.key.endsWith(":checkout:cs_test_1"));
  const sub = effects.records.find((record) => record.key.endsWith(":subscription:sub_test_1"));
  assert.equal(checkout.state.paymentStatus, "paid");
  assert.equal(checkout.state.billingAccessState, "unlinked");
  assert.equal(checkout.state.callerReferencePresent, true);
  assert.equal(sub.state.status, "active");
  assert.equal(sub.state.billingAccessState, "unlinked");
  assert.equal(sub.state.identityLinkRequired, true);
});

test("invoice.paid records canonical paid state and current subscription snapshot", async () => {
  const stripe = fakeStripe({
    currentInvoice: {
      id: "in_test_paid", status: "paid", customer: "cus_test_1", subscription: "sub_test_1",
      amount_due: 2500, amount_paid: 2500, amount_remaining: 0, currency: "cad", attempt_count: 1,
    },
  });
  const effects = await buildStripeBillingEffects(
    event("evt_invoice_paid", "invoice.paid", { id: "in_test_paid", subscription: "sub_test_1" }),
    stripe,
  );
  const invoice = effects.records.find((record) => record.key.endsWith(":invoice:in_test_paid"));
  assert.equal(invoice.state.paymentOutcome, "paid");
  assert.equal(invoice.state.amountPaid, 2500);
  assert.ok(effects.records.some((record) => record.key.endsWith(":subscription:sub_test_1")));
});

test("invoice.payment_failed records a failed payment without inventing cancellation", async () => {
  const stripe = fakeStripe({
    currentInvoice: {
      id: "in_test_failed", status: "open", customer: "cus_test_1", subscription: "sub_test_1",
      amount_due: 2500, amount_paid: 0, amount_remaining: 2500, currency: "cad", attempt_count: 2,
    },
    currentSubscription: subscription("sub_test_1", { status: "past_due" }),
  });
  const effects = await buildStripeBillingEffects(
    event("evt_invoice_failed", "invoice.payment_failed", { id: "in_test_failed", subscription: "sub_test_1" }),
    stripe,
  );
  const invoice = effects.records.find((record) => record.key.endsWith(":invoice:in_test_failed"));
  const sub = effects.records.find((record) => record.key.endsWith(":subscription:sub_test_1"));
  assert.equal(invoice.state.paymentOutcome, "payment_failed");
  assert.equal(sub.state.status, "past_due");
  assert.notEqual(sub.state.status, "canceled");
});

test("subscription.updated preserves active status and records period-end cancellation", async () => {
  const stripe = fakeStripe({
    currentSubscription: subscription("sub_scheduled_cancel", { cancel_at_period_end: true }),
  });
  const effects = await buildStripeBillingEffects(
    event("evt_subscription_updated", "customer.subscription.updated", { id: "sub_scheduled_cancel" }),
    stripe,
  );
  const sub = effects.records[0].state;
  assert.equal(sub.status, "active");
  assert.equal(sub.cancelAtPeriodEnd, true);
  assert.equal(sub.currentPeriodEnd, now + 86400);
  assert.equal(sub.billingAccessState, "unlinked");
});

test("subscription.deleted writes a terminal canceled state", async () => {
  const deleted = subscription("sub_deleted", { status: "canceled", canceled_at: now, ended_at: now });
  const effects = await buildStripeBillingEffects(
    event("evt_subscription_deleted", "customer.subscription.deleted", deleted),
    fakeStripe(),
  );
  assert.equal(effects.records[0].state.status, "canceled");
  assert.equal(effects.records[0].rank, 2);
});

test("charge.dispute.created persists a review record and customer risk flag", async () => {
  const effects = await buildStripeBillingEffects(
    event("evt_dispute", "charge.dispute.created", {
      id: "dp_test_1", charge: "ch_test_1", payment_intent: "pi_test_1",
      status: "needs_response", reason: "product_not_received", amount: 2500, currency: "cad",
      evidence_details: { due_by: now + 86400 },
    }),
    fakeStripe(),
  );
  const dispute = effects.records.find((record) => record.key.endsWith(":dispute:dp_test_1"));
  const risk = effects.records.find((record) => record.key.endsWith(":customer-risk:cus_test_1"));
  assert.equal(dispute.state.reviewRequired, true);
  assert.equal(dispute.state.paymentIntentId, "pi_test_1");
  assert.equal(risk.state.disputeReviewRequired, true);
});

test("billing effects use one atomic Redis script for state updates and processed-event marker", async () => {
  const calls = [];
  const redis = {
    async eval(...args) {
      calls.push(args);
      return calls.length === 1 ? 1 : 0;
    },
  };
  const effects = {
    eventId: "evt_apply_once",
    eventType: "invoice.paid",
    eventCreated: now,
    records: [{
      key: "billing:stripe:invoice:in_apply_once",
      rank: 2,
      state: { eventId: "evt_apply_once", eventCreated: now, paymentOutcome: "paid" },
    }],
  };

  assert.equal(await applyStripeBillingEffects(redis, effects), true);
  assert.equal(await applyStripeBillingEffects(redis, effects), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1], 2);
  assert.equal(calls[0][2], "billing:stripe:consumer-processed:evt_apply_once");
  assert.match(calls[0][0], /EXISTS/);
  assert.match(calls[0][0], /SET/);
  assert.equal(JSON.parse(calls[0][10]).paymentOutcome, "paid");
});
