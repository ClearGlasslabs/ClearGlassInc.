import assert from "node:assert/strict";
import test from "node:test";
import {
  isApprovedCheckoutPrice,
  resolveCheckoutMode,
} from "../src/billing-config.js";

test("allowlisted active one-time Price resolves to payment mode", () => {
  const price = {
    id: "price_live_one_time",
    active: true,
    livemode: true,
    type: "one_time",
    recurring: null,
  };
  assert.equal(isApprovedCheckoutPrice(price, price.id, new Set([price.id]), "sk_live_checkout_test"), true);
  assert.equal(resolveCheckoutMode(price), "payment");
});

test("allowlisted active recurring Price resolves to subscription mode", () => {
  const price = {
    id: "price_live_recurring",
    active: true,
    livemode: true,
    type: "recurring",
    recurring: { interval: "month", interval_count: 1 },
  };
  assert.equal(isApprovedCheckoutPrice(price, price.id, new Set([price.id]), "rk_live_checkout_test"), true);
  assert.equal(resolveCheckoutMode(price), "subscription");
});

test("Checkout Price is rejected when inactive, not allowlisted, or in the other Stripe mode", () => {
  const allowlist = new Set(["price_live_recurring"]);
  const livePrice = {
    id: "price_live_recurring",
    active: true,
    livemode: true,
    type: "recurring",
    recurring: { interval: "month" },
  };
  assert.equal(isApprovedCheckoutPrice(livePrice, livePrice.id, allowlist, "sk_test_key"), false);
  assert.equal(isApprovedCheckoutPrice({ ...livePrice, active: false }, livePrice.id, allowlist, "sk_live_key"), false);
  assert.equal(isApprovedCheckoutPrice(livePrice, livePrice.id, new Set(), "sk_live_key"), false);
  assert.equal(isApprovedCheckoutPrice(livePrice, "price_attacker_choice", allowlist, "sk_live_key"), false);
  assert.equal(isApprovedCheckoutPrice(livePrice, livePrice.id, allowlist, ""), false);
});

test("inconsistent Price billing shape fails closed", () => {
  assert.throws(() => resolveCheckoutMode({
    id: "price_bad",
    active: true,
    type: "one_time",
    recurring: { interval: "month" },
  }), /inconsistent billing type/);
});
