import assert from "node:assert/strict";
import test from "node:test";
import { OFFERS, PLANS, loadSubscriptionConfig } from "../src/subscriptions/config.js";

const base = {
  NODE_ENV: "test",
  STRIPE_SECRET_KEY: "sk_test_config_unit_only",
  DATABASE_URL: "postgres://localhost/unit",
  AUTH_SECRET: "a".repeat(40),
  APP_BASE_URL: "http://localhost:8080/ignored/path",
  SITE_BASE_URL: "http://localhost:3000",
  STRIPE_PRICE_SIGNAL_MONTHLY: "price_signalmonthly1",
};

test("registry defines the required plans and offer IDs", () => {
  assert.deepEqual(PLANS.map((p) => p.key), ["signal", "assurance", "northstar"]);
  assert.deepEqual(OFFERS.map((o) => o.id), ["signal_monthly", "signal_annual", "assurance_monthly", "assurance_annual", "northstar_enterprise"]);
});

test("valid config exposes only configured offers; unconfigured offers have no price", () => {
  const ctx = loadSubscriptionConfig(base);
  assert.equal(ctx.ok, true, ctx.errors.join());
  assert.equal(ctx.appOrigin, "http://localhost:8080");
  assert.equal(ctx.mode, "test");
  assert.equal(ctx.offers.get("signal_monthly").priceId, "price_signalmonthly1");
  assert.equal(ctx.offers.get("signal_annual").priceId, null);
  assert.equal(ctx.offers.get("northstar_enterprise").priceId, null);
  assert.equal(ctx.trialAccess, false);
  assert.deepEqual([...ctx.priceMap.keys()], ["price_signalmonthly1"]);
});

test("invalid or duplicate Price IDs, weak secrets and bad URLs are rejected without echoing values", () => {
  const ctx = loadSubscriptionConfig({
    ...base, AUTH_SECRET: "short", STRIPE_PRICE_SIGNAL_ANNUAL: "prod_notaprice", STRIPE_PRICE_ASSURANCE_MONTHLY: "price_signalmonthly1",
  });
  assert.equal(ctx.ok, false);
  const text = ctx.errors.join("|");
  assert.match(text, /AUTH_SECRET/);
  assert.match(text, /STRIPE_PRICE_SIGNAL_ANNUAL/);
  assert.match(text, /duplicates/);
  assert.doesNotMatch(text, /prod_notaprice|short/);
});

test("production requires HTTPS origins and a Stripe key", () => {
  const ctx = loadSubscriptionConfig({ ...base, NODE_ENV: "production", STRIPE_SECRET_KEY: "", APP_BASE_URL: "http://localhost:8080" });
  assert.equal(ctx.ok, false);
  assert.ok(ctx.errors.some((e) => e.startsWith("APP_BASE_URL")));
  assert.ok(ctx.errors.some((e) => e.startsWith("STRIPE_SECRET_KEY")));
});

test("live and test keys are distinguished and a Northstar-only configuration is not enough", () => {
  assert.equal(loadSubscriptionConfig({ ...base, STRIPE_SECRET_KEY: "rk_live_unit_only" }).livemode, true);
  const ctx = loadSubscriptionConfig({ ...base, STRIPE_PRICE_SIGNAL_MONTHLY: "", STRIPE_PRICE_NORTHSTAR_ENTERPRISE: "price_northstar001" });
  assert.equal(ctx.ok, false);
});

test("trial policy defaults to deny and rejects unknown values", () => {
  assert.equal(loadSubscriptionConfig({ ...base, SUBSCRIPTION_TRIAL_ACCESS: "allow" }).trialAccess, true);
  assert.equal(loadSubscriptionConfig({ ...base, SUBSCRIPTION_TRIAL_ACCESS: "maybe" }).ok, false);
});
