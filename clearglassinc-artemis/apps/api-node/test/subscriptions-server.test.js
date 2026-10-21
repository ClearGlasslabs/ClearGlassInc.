import assert from "node:assert/strict";
import test from "node:test";

Object.assign(process.env, {
  NODE_ENV: "test", STRIPE_SECRET_KEY: "sk_test_server_membership_only", DATABASE_URL: "postgres://unused/unused",
  AUTH_SECRET: "s".repeat(48), APP_BASE_URL: "http://localhost:8080", SITE_BASE_URL: "http://localhost:3000",
  STRIPE_PRICE_SIGNAL_MONTHLY: "price_signalmonthly1", STRIPE_ALLOWED_PRICE_IDS: "price_signalmonthly1,price_legacyseat1",
  ALLOWED_ORIGINS: "http://localhost:3000",
});
const { app } = await import("../src/server.js");
const { redis } = await import("../src/redis.js");
test.after(() => redis.disconnect());

async function withServer(fn) {
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((r) => server.close(r)); }
}

test("legacy generic checkout refuses membership prices (they must start from an account)", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/v1/billing/checkout-sessions`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ priceId: "price_signalmonthly1" }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "membership_requires_account");
  });
});

test("account pages require a session; healthz reports state", async () => {
  await withServer(async (base) => {
    const account = await fetch(`${base}/account`);
    assert.equal(account.status, 200);
    const html = await account.text();
    assert.match(html, /Sign in with email/);
    assert.match(account.headers.get("content-security-policy"), /script-src 'self'/);
    assert.equal((await fetch(`${base}/account/api/me`)).status, 401);
    assert.equal((await (await fetch(`${base}/healthz`)).json()).subscriptionsConfigured, true);
  });
});
