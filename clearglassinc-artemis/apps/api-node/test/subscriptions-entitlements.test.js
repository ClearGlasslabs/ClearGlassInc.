import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSubscription, planAllows, resolveEntitlement } from "../src/subscriptions/entitlements.js";

const now = new Date("2030-01-15T00:00:00Z");
const policy = { livemode: false, trialAccess: false, graceSeconds: 0 };
const row = (over = {}) => ({
  stripe_subscription_id: "sub_1", plan_key: "signal", status: "active", livemode: false,
  current_period_end: "2030-02-01T00:00:00Z", cancel_at_period_end: false,
  latest_invoice_status: "paid", latest_invoice_reason: "subscription_create", deleted_at: null, ...over,
});

test("active, paid subscriptions inside the verified period grant access", () => {
  assert.equal(evaluateSubscription(row(), now, policy).entitled, true);
});

for (const status of ["past_due", "unpaid", "incomplete", "incomplete_expired", "paused", "canceled"]) {
  test(`status ${status} is denied`, () => {
    assert.equal(evaluateSubscription(row({ status }), now, policy).entitled, false);
  });
}

test("trialing is denied by default and allowed only when policy says so", () => {
  assert.equal(evaluateSubscription(row({ status: "trialing" }), now, policy).entitled, false);
  assert.equal(evaluateSubscription(row({ status: "trialing" }), now, { ...policy, trialAccess: true }).entitled, true);
});

test("cancel_at_period_end stays valid only until the verified period end", () => {
  const r = row({ cancel_at_period_end: true });
  assert.equal(evaluateSubscription(r, now, policy).entitled, true);
  assert.equal(evaluateSubscription(r, new Date("2030-02-01T00:00:01Z"), policy).entitled, false);
});

test("a missed webhook cannot extend access past the stored period end", () => {
  assert.equal(evaluateSubscription(row(), new Date("2031-01-01T00:00:00Z"), policy).entitled, false);
  assert.equal(evaluateSubscription(row({ current_period_end: null }), now, policy).entitled, false);
});

test("paid-vs-active: an active subscription with an unpaid first invoice is denied", () => {
  assert.equal(evaluateSubscription(row({ latest_invoice_status: "open" }), now, policy).reason, "first_payment_unconfirmed");
  assert.equal(evaluateSubscription(row({ latest_invoice_status: "open", latest_invoice_reason: "subscription_cycle" }), now, policy).entitled, true);
  assert.equal(evaluateSubscription(row({ latest_invoice_status: "uncollectible" }), now, policy).entitled, false);
});

test("deleted, unknown-plan and wrong-mode rows are denied", () => {
  assert.equal(evaluateSubscription(row({ deleted_at: now }), now, policy).entitled, false);
  assert.equal(evaluateSubscription(row({ plan_key: null }), now, policy).entitled, false);
  assert.equal(evaluateSubscription(row({ livemode: true }), now, policy).entitled, false);
});

test("multiple subscriptions resolve to the union (highest plan, latest end)", () => {
  const e = resolveEntitlement([
    row({ stripe_subscription_id: "a", plan_key: "signal" }),
    row({ stripe_subscription_id: "b", plan_key: "assurance", current_period_end: "2030-03-01T00:00:00Z" }),
    row({ stripe_subscription_id: "c", plan_key: "northstar", status: "past_due" }),
  ], now, policy);
  assert.equal(e.plan, "assurance");
  assert.equal(e.until, "2030-03-01T00:00:00.000Z");
  assert.ok(e.areas.includes("governance_materials") && e.areas.includes("briefings") && !e.areas.includes("evidence_workspace"));
  assert.equal(planAllows(e, "signal"), true);
  assert.equal(planAllows(e, "northstar"), false);
  assert.equal(resolveEntitlement([], now, policy).active, false);
});
