import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import test from "node:test";
import { loadSubscriptionConfig } from "../src/subscriptions/config.js";
import { createDb, runMigrations } from "../src/subscriptions/db.js";
import { applySubscriptionEvent, persistCanonicalSubscriptions } from "../src/subscriptions/fulfillment.js";
import { createSubscriptionRouter } from "../src/subscriptions/routes.js";
import { resetOfferCache } from "../src/subscriptions/offers.js";
import { processEntry } from "../src/stripe-worker.js";

const PG_URL = process.env.SUBSCRIPTIONS_PG_TEST_URL;
const skip = PG_URL ? false : "SUBSCRIPTIONS_PG_TEST_URL is not set";
const APP = "http://localhost:8099";
const SITE = "http://localhost:3000";
const PERIOD_END = Math.floor(Date.now() / 1000) + 30 * 86_400;
const env = {
  NODE_ENV: "test", STRIPE_SECRET_KEY: "sk_test_subscription_ci_only", DATABASE_URL: "postgres://unused/unused",
  AUTH_SECRET: "t".repeat(48), APP_BASE_URL: APP, SITE_BASE_URL: SITE,
  STRIPE_PRICE_SIGNAL_MONTHLY: "price_signalmonthly1", STRIPE_PRICE_ASSURANCE_MONTHLY: "price_assurancemonth1",
};

function fakeStripe() {
  const state = { subscriptions: new Map(), calls: { checkout: [], portal: [], customers: [], list: 0 }, missing: new Set() };
  return {
    state,
    prices: {
      retrieve: async (id) => ({ id, active: true, type: "recurring", livemode: false, unit_amount: 1234, currency: "cad", recurring: { interval: "month", interval_count: 1 } }),
    },
    customers: { create: async (params) => { state.calls.customers.push(params); return { id: `cus_${crypto.randomBytes(6).toString("hex")}` }; } },
    checkout: {
      sessions: {
        create: async (params) => { state.calls.checkout.push(params); return { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }; },
        retrieve: async (id) => ({ id, mode: "subscription", subscription: state.checkoutSubscription ?? null }),
      },
    },
    billingPortal: { sessions: { create: async (params) => { state.calls.portal.push(params); return { url: "https://billing.stripe.com/p/session/test" }; } } },
    subscriptions: {
      retrieve: async (id) => {
        if (state.missing.has(id)) throw Object.assign(new Error("missing"), { code: "resource_missing" });
        return state.subscriptions.get(id);
      },
      list: async () => { state.calls.list += 1; return { data: [...state.subscriptions.values()] }; },
    },
  };
}

function subscription({ id = "sub_1", customer, status = "active", price = "price_signalmonthly1", over = {}, metadataUser } = {}) {
  return {
    id, customer, status, livemode: false, current_period_end: PERIOD_END, cancel_at_period_end: false,
    items: { data: [{ price: { id: price }, quantity: 1 }] },
    latest_invoice: { status: "paid", billing_reason: "subscription_create" },
    metadata: metadataUser ? { user_id: metadataUser } : {},
    ...over,
  };
}

let seq = 0;
const event = (type, object) => ({ id: `evt_${type.replace(/\W/g, "_")}_${++seq}`, type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });

async function harness(t, { catalog, mailerFails = false } = {}) {
  const schema = `t_${crypto.randomBytes(6).toString("hex")}`;
  const admin = createDb(PG_URL, { max: 1 });
  await admin.query(`create schema ${schema}`);
  const url = new URL(PG_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const db = createDb(url.toString(), { max: 8 });
  await runMigrations(db, path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations"));
  resetOfferCache();
  const ctx = loadSubscriptionConfig(env);
  assert.equal(ctx.ok, true, ctx.errors.join());
  const stripe = fakeStripe();
  const sent = [];
  const mailer = { send: async (message) => { if (mailerFails) throw new Error("smtp down"); sent.push(message); } };
  const app = express();
  app.set("trust proxy", 1);
  app.use(createSubscriptionRouter({ db, stripe, mailer, ctx, catalog: catalog ?? { areas: [] } }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.end();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  });

  const call = (method, route, { cookie, csrf, body, origin = APP, form } = {}) => fetch(base + route, {
    method, redirect: "manual",
    headers: {
      ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : body ? { "Content-Type": "application/json" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : undefined,
  });

  async function signIn(email, extra = {}) {
    const before = sent.length;
    const res = await call("POST", "/account/api/auth/request", { body: { email, ...extra } });
    assert.equal(res.status, 202);
    const message = sent[before];
    const token = new URL(message.text.match(/https?:\/\/\S+/)[0]).searchParams.get("token");
    const verified = await call("POST", "/account/auth/verify", { form: { token } });
    assert.equal(verified.status, 303);
    const cookie = verified.headers.get("set-cookie").split(";")[0];
    const me = await (await call("GET", "/account/api/me", { cookie })).json();
    return { cookie, csrf: me.csrfToken, token, verified, me };
  }

  const user = async (email) => (await db.query("select id from users where email = $1", [email])).rows[0];
  const mapCustomer = async (userId, customerId = `cus_${crypto.randomBytes(5).toString("hex")}`) => {
    await db.query("insert into stripe_customers (user_id, stripe_customer_id, livemode) values ($1,$2,false)", [userId, customerId]);
    return customerId;
  };
  const apply = (type, object) => applySubscriptionEvent({ db, stripe, ctx, event: event(type, object) });
  return { db, ctx, stripe, sent, call, signIn, user, mapCustomer, apply, base };
}

test("sign-in: single-use hashed challenge, secure cookie flags, origin + rate limits", { skip }, async (t) => {
  const h = await harness(t);
  assert.equal((await h.call("POST", "/account/api/auth/request", { body: { email: "a@example.com" }, origin: "https://evil.example" })).status, 403);
  assert.equal((await h.call("POST", "/account/api/auth/request", { body: { email: "a@example.com" }, origin: null })).status, 403);
  assert.equal((await h.call("POST", "/account/api/auth/request", { body: { email: "not-an-email" } })).status, 400);

  const { token, verified } = await h.signIn("a@example.com");
  const setCookie = verified.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  const stored = (await h.db.query("select token_hash from auth_challenges")).rows[0].token_hash;
  assert.notEqual(stored, token);
  assert.equal((await h.db.query("select count(*)::int n from sessions where token_hash = $1", [token])).rows[0].n, 0);
  assert.equal((await h.call("POST", "/account/auth/verify", { form: { token } })).status, 400);

  await h.call("POST", "/account/api/auth/request", { body: { email: "b@example.com" } });
  await h.db.query("update auth_challenges set expires_at = now() - interval '1 minute' where email = 'b@example.com'");
  const expiredToken = new URL(h.sent.at(-1).text.match(/https?:\/\/\S+/)[0]).searchParams.get("token");
  assert.equal((await h.call("POST", "/account/auth/verify", { form: { token: expiredToken } })).status, 400);

  const sentBefore = h.sent.length;
  for (let i = 0; i < 8; i += 1) assert.equal((await h.call("POST", "/account/api/auth/request", { body: { email: "c@example.com" } })).status, 202);
  assert.equal(h.sent.length - sentBefore, 5, "per-address limit is enforced durably and silently");
});

test("sign-in email delivery failure is reported safely", { skip }, async (t) => {
  const h = await harness(t, { mailerFails: true });
  const res = await h.call("POST", "/account/api/auth/request", { body: { email: "a@example.com" } });
  assert.equal(res.status, 502);
  assert.deepEqual(Object.keys(await res.json()).sort(), ["error", "requestId"]);
});

test("unauthenticated, CSRF-less and cross-origin requests cannot reach billing or content", { skip }, async (t) => {
  const h = await harness(t);
  assert.equal((await h.call("GET", "/account/api/me")).status, 401);
  assert.equal((await h.call("POST", "/account/api/billing/portal")).status, 401);
  assert.equal((await h.call("POST", "/account/api/billing/checkout", { body: { plan: "signal", interval: "monthly" } })).status, 401);
  assert.equal((await h.call("GET", "/account/library")).status, 303);
  const { cookie, csrf } = await h.signIn("a@example.com");
  assert.equal((await h.call("POST", "/account/api/billing/portal", { cookie })).status, 403);
  assert.equal((await h.call("POST", "/account/api/billing/portal", { cookie, csrf: "bad" })).status, 403);
  assert.equal((await h.call("POST", "/account/api/billing/portal", { cookie, csrf, origin: "https://evil.example" })).status, 403);
  assert.equal((await h.call("POST", "/account/api/billing/portal", { cookie, csrf })).status, 404, "no billing account yet");
  const out = await h.call("POST", "/account/api/auth/logout", { cookie, csrf });
  assert.equal(out.status, 200);
  assert.equal((await h.call("GET", "/account/api/me", { cookie })).status, 401);
});

test("checkout: allowlisted plans only, trusted customer mapping and metadata, no session-id grant", { skip }, async (t) => {
  const h = await harness(t);
  const { cookie, csrf } = await h.signIn("Buyer@Example.com");
  const post = (body) => h.call("POST", "/account/api/billing/checkout", { cookie, csrf, body });

  assert.equal((await post({ priceId: "price_attacker", amount: 1 })).status, 400);
  assert.equal((await post({ plan: "signal", interval: "weekly" })).status, 400);
  assert.equal((await post({ plan: "gold", interval: "monthly" })).status, 400);
  assert.equal((await post({ plan: "signal", interval: "annual" })).status, 409, "unconfigured annual price");
  const northstar = await post({ plan: "northstar", interval: "enterprise" });
  assert.equal(northstar.status, 409);
  assert.equal((await northstar.json()).error, "contact_required");
  assert.equal(h.stripe.state.calls.checkout.length, 0);

  const ok = await post({ plan: "signal", interval: "monthly", quantity: 50, customer: "cus_evil", email: "x@evil.example", success_url: "https://evil.example" });
  assert.equal(ok.status, 201);
  const session = h.stripe.state.calls.checkout[0];
  const u = await h.user("buyer@example.com");
  const mapped = (await h.db.query("select stripe_customer_id from stripe_customers where user_id = $1", [u.id])).rows[0].stripe_customer_id;
  assert.equal(session.mode, "subscription");
  assert.equal(session.customer, mapped);
  assert.equal(session.client_reference_id, u.id);
  assert.deepEqual(session.line_items, [{ price: "price_signalmonthly1", quantity: 1 }]);
  assert.deepEqual(session.metadata, { user_id: u.id, plan_key: "signal", billing_interval: "monthly", environment: "test", source: "clearglass-membership" });
  assert.deepEqual(session.subscription_data.metadata, session.metadata);
  assert.equal(session.success_url, `${APP}/account?checkout=success`);
  assert.equal(session.cancel_url, `${APP}/account?checkout=cancelled`);
  assert.equal(h.stripe.state.calls.customers[0].email, "buyer@example.com");

  const success = await h.call("GET", "/account?checkout=success&session_id=cs_test_1", { cookie });
  assert.equal(success.status, 200);
  const me = await (await h.call("GET", "/account/api/me", { cookie })).json();
  assert.equal(me.entitlement.active, false, "return URL never grants access");
});

test("webhook fulfilment: grant, duplicate, update, payment failure, cancel-at-period-end, deletion", { skip }, async (t) => {
  const catalog = { areas: [
    { id: "briefings", title: "Briefings", minPlan: "signal", items: [{ slug: "s-1", title: "Signal item", body: "Hello" }] },
    { id: "governance_materials", title: "Gov", minPlan: "assurance", items: [{ slug: "a-1", title: "Assurance item", body: "Secret" }] },
  ] };
  const h = await harness(t, { catalog });
  const { cookie, csrf } = await h.signIn("m@example.com");
  const u = await h.user("m@example.com");
  const customer = await h.mapCustomer(u.id);
  const me = async () => (await (await h.call("GET", "/account/api/me", { cookie })).json()).entitlement;
  const item = async (slug) => (await h.call("GET", `/account/library/${slug}`, { cookie })).status;

  assert.equal(await item("s-1"), 403, "no subscription yet");
  h.stripe.state.subscriptions.set("sub_1", subscription({ customer, metadataUser: u.id }));
  const created = event("customer.subscription.created", { id: "sub_1" });
  assert.equal((await applySubscriptionEvent({ db: h.db, stripe: h.stripe, ctx: h.ctx, event: created })).status, "processed");
  assert.equal((await applySubscriptionEvent({ db: h.db, stripe: h.stripe, ctx: h.ctx, event: created })).status, "duplicate");
  assert.equal((await h.db.query("select count(*)::int n from stripe_events where event_id = $1", [created.id])).rows[0].n, 1);
  assert.equal((await me()).plan, "signal");
  assert.equal(await item("s-1"), 200);
  assert.equal(await item("a-1"), 403, "plan tier is enforced server-side");
  assert.equal((await h.call("POST", "/account/api/billing/checkout", { cookie, csrf, body: { plan: "signal", interval: "monthly" } })).status, 409);

  h.stripe.state.subscriptions.set("sub_1", subscription({ customer, over: { cancel_at_period_end: true } }));
  await h.apply("customer.subscription.updated", { id: "sub_1" });
  assert.equal((await me()).active, true, "cancel_at_period_end remains valid to period end");
  await h.db.query("update subscriptions set current_period_end = now() - interval '1 second'");
  assert.equal((await me()).active, false, "expired period denies even without a webhook");
  assert.equal(await item("s-1"), 403);

  h.stripe.state.subscriptions.set("sub_1", subscription({ customer, status: "past_due", over: { latest_invoice: { status: "open", billing_reason: "subscription_cycle" } } }));
  await h.apply("invoice.payment_failed", { id: "in_1", subscription: "sub_1" });
  assert.equal((await me()).active, false);
  h.stripe.state.subscriptions.set("sub_1", subscription({ customer }));
  await h.apply("invoice.paid", { id: "in_2", parent: { subscription_details: { subscription: "sub_1" } } });
  assert.equal((await me()).active, true);

  h.stripe.state.missing.add("sub_1");
  await h.apply("customer.subscription.deleted", subscription({ customer, status: "canceled" }));
  assert.equal((await me()).active, false);
  const row = (await h.db.query("select status, deleted_at from subscriptions")).rows[0];
  assert.equal(row.status, "canceled");
  assert.ok(row.deleted_at);
  assert.ok((await h.db.query("select count(*)::int n from billing_audit where action = 'subscription_synced'")).rows[0].n >= 4);

  h.stripe.state.missing.delete("sub_1");
  h.stripe.state.subscriptions.set("sub_1", subscription({ customer }));
  await h.apply("customer.subscription.updated", { id: "sub_1" });
  assert.equal((await me()).active, false, "a stale non-terminal event cannot resurrect a canceled subscription");
});

test("out-of-order canonical writes, concurrency, linkage and union", { skip }, async (t) => {
  const h = await harness(t);
  await h.signIn("o@example.com");
  const u = await h.user("o@example.com");
  const customer = await h.mapCustomer(u.id);
  const t1 = new Date(Date.now() - 5000); const t2 = new Date();
  const item = (sub, verifiedAt, deleted = false) => ({ id: sub.id, subscription: sub, verifiedAt, deleted });
  const read = async (id) => (await h.db.query("select status from subscriptions where stripe_subscription_id = $1", [id])).rows[0]?.status;

  await persistCanonicalSubscriptions({ db: h.db, ctx: h.ctx, event: event("customer.subscription.updated", {}), items: [item(subscription({ customer, status: "past_due" }), t2)] });
  await persistCanonicalSubscriptions({ db: h.db, ctx: h.ctx, event: event("customer.subscription.updated", {}), items: [item(subscription({ customer, status: "active" }), t1)] });
  assert.equal(await read("sub_1"), "past_due", "older verification does not overwrite newer state");

  // concurrent duplicates of one event: exactly one applies
  h.stripe.state.subscriptions.set("sub_c", subscription({ id: "sub_c", customer }));
  const dup = event("customer.subscription.created", { id: "sub_c" });
  const results = await Promise.all(Array.from({ length: 6 }, () => applySubscriptionEvent({ db: h.db, stripe: h.stripe, ctx: h.ctx, event: dup })));
  assert.equal(results.filter((r) => r.status === "processed").length, 1);
  assert.equal(results.filter((r) => r.status === "duplicate").length, 5);

  // linkage: foreign metadata user and unmapped customers never grant access
  const other = (await h.db.query("insert into users (email) values ('x@example.com') returning id")).rows[0].id;
  h.stripe.state.subscriptions.set("sub_m", subscription({ id: "sub_m", customer, metadataUser: other }));
  h.stripe.state.subscriptions.set("sub_u", subscription({ id: "sub_u", customer: "cus_unknown" }));
  await h.apply("customer.subscription.created", { id: "sub_m" });
  await h.apply("customer.subscription.created", { id: "sub_u" });
  assert.equal(await read("sub_m"), undefined);
  assert.equal(await read("sub_u"), undefined);
  assert.ok((await h.db.query("select 1 from billing_audit where action in ('subscription_linkage_mismatch','subscription_unlinked')")).rowCount >= 2);

  // unknown (legacy per-seat) price is stored without a plan and grants nothing; union picks the highest plan
  h.stripe.state.subscriptions.set("sub_legacy", subscription({ id: "sub_legacy", customer, price: "price_legacyseat1" }));
  h.stripe.state.subscriptions.set("sub_hi", subscription({ id: "sub_hi", customer, price: "price_assurancemonth1" }));
  h.stripe.state.subscriptions.set("sub_c", subscription({ id: "sub_c", customer }));
  await h.apply("customer.subscription.created", { id: "sub_legacy" });
  await h.apply("customer.subscription.created", { id: "sub_hi" });
  await h.apply("customer.subscription.updated", { id: "sub_c" });
  const ent = (await h.db.query("select plan_key from entitlements where user_id = $1", [u.id])).rows[0];
  assert.equal(ent.plan_key, "assurance");
  assert.equal((await h.db.query("select plan_key from subscriptions where stripe_subscription_id = 'sub_legacy'")).rows[0].plan_key, null);

  // livemode mismatch is rejected (retryable error, no grant)
  h.stripe.state.subscriptions.set("sub_live", { ...subscription({ id: "sub_live", customer }), livemode: true });
  await assert.rejects(h.apply("customer.subscription.created", { id: "sub_live" }));
  assert.equal(await read("sub_live"), undefined);
});

test("checkout.session.completed fulfils from canonical Stripe state; unpaid first invoice is not access", { skip }, async (t) => {
  const h = await harness(t);
  await h.signIn("p@example.com");
  const u = await h.user("p@example.com");
  const customer = await h.mapCustomer(u.id);
  h.stripe.state.checkoutSubscription = "sub_p";
  h.stripe.state.subscriptions.set("sub_p", subscription({ id: "sub_p", customer, status: "active", over: { latest_invoice: { status: "open", billing_reason: "subscription_create" } } }));
  await h.apply("checkout.session.completed", { id: "cs_1" });
  assert.equal((await h.db.query("select count(*)::int n from subscriptions")).rows[0].n, 1);
  const { cookie } = await h.signIn("p@example.com");
  assert.equal((await (await h.call("GET", "/account/api/me", { cookie })).json()).entitlement.active, false);
  assert.equal((await h.call("GET", "/account/library", { cookie })).status, 200);
});

test("portal uses the trusted mapped customer, including former subscribers; refresh reconciles from Stripe", { skip }, async (t) => {
  const h = await harness(t);
  const { cookie, csrf } = await h.signIn("f@example.com");
  const u = await h.user("f@example.com");
  const customer = await h.mapCustomer(u.id);
  await h.db.query("insert into subscriptions (stripe_subscription_id,user_id,stripe_customer_id,plan_key,status,livemode,last_event_id,last_verified_at,deleted_at) values ('sub_old',$1,$2,'signal','canceled',false,'e',now(),now())", [u.id, customer]);
  const portal = await h.call("POST", "/account/api/billing/portal", { cookie, csrf, body: { customer: "cus_evil" } });
  assert.equal(portal.status, 201);
  assert.equal(h.stripe.state.calls.portal[0].customer, customer);
  assert.equal(h.stripe.state.calls.portal[0].return_url, `${APP}/account`);

  h.stripe.state.subscriptions.set("sub_new", subscription({ id: "sub_new", customer }));
  const refresh = await h.call("POST", "/account/api/billing/refresh", { cookie, csrf });
  assert.equal((await refresh.json()).entitlement.plan, "signal");
  assert.equal(h.stripe.state.calls.list, 1);
});

test("public plan endpoint reports unconfigured offers and never invents prices", { skip }, async (t) => {
  const h = await harness(t);
  const res = await fetch(`${h.base}/v1/subscriptions/plans`, { headers: { Origin: SITE } });
  assert.equal(res.headers.get("access-control-allow-origin"), SITE);
  const body = await res.json();
  const offers = Object.fromEntries(body.plans.flatMap((p) => p.offers.map((o) => [o.id, o])));
  assert.equal(offers.signal_monthly.state, "available");
  assert.equal(offers.signal_monthly.amount, "$12.34");
  assert.equal(offers.signal_annual.state, "unconfigured");
  assert.equal(offers.signal_annual.amount, undefined);
  assert.equal(offers.northstar_enterprise.state, "contact");
  const foreign = await fetch(`${h.base}/v1/subscriptions/plans`, { headers: { Origin: "https://evil.example" } });
  assert.equal(foreign.headers.get("access-control-allow-origin"), null);
});

test("worker commits subscriber state to Postgres before acknowledging the stream entry", { skip }, async (t) => {
  const h = await harness(t);
  await h.signIn("w@example.com");
  const u = await h.user("w@example.com");
  const customer = await h.mapCustomer(u.id);
  h.stripe.state.subscriptions.set("sub_w", subscription({ id: "sub_w", customer }));
  const ev = { ...event("customer.subscription.created", { id: "sub_w" }), id: "evt_worker_pg" };
  const order = [];
  const redis = {
    eval: async () => { order.push("redis"); return 1; },
    xack: async () => { order.push("ack"); return 1; },
    del: async () => 1, incr: async () => 1, expire: async () => 1,
  };
  const fields = ["provider", "stripe", "event_id", ev.id, "event_type", ev.type, "payload", JSON.stringify(ev)];
  const previous = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_subscription_ci_only";
  try {
    await processEntry(redis, h.stripe, "1-0", fields, { db: h.db, ctx: h.ctx });
    assert.equal((await h.db.query("select status from subscriptions where stripe_subscription_id = 'sub_w'")).rows[0].status, "active");
    assert.deepEqual(order, ["redis", "ack"]);

    // a Postgres failure must leave the entry unacknowledged for retry
    order.length = 0;
    const broken = { db: { tx: async () => { throw new Error("pg down"); }, query: async () => { throw new Error("pg down"); } }, ctx: h.ctx };
    await processEntry(redis, h.stripe, "2-0", fields.map((f) => (f === ev.id ? "evt_other" : f)).map((f) => (typeof f === "string" && f.startsWith("{") ? JSON.stringify({ ...ev, id: "evt_other" }) : f)), broken);
    assert.deepEqual(order, []);
  } finally {
    if (previous === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = previous;
  }
});
