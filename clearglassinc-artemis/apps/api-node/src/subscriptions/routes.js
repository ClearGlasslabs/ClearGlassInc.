import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { offerFor } from "./config.js";
import {
  COOKIE_NAME, CHALLENGE_TTL_MINUTES, SESSION_ABSOLUTE_SECONDS, consumeRateLimit, createChallenge, csrfTokenFor,
  loadSession, normalizeEmail, parseCookies, redeemChallenge, revokeSession, safeEqual, sessionCookie,
} from "./auth.js";
import { loadEntitlement, planAllows } from "./entitlements.js";
import { syncUserSubscriptions } from "./fulfillment.js";
import { loginEmail } from "./mail.js";
import { describeOffers } from "./offers.js";
import { PAGE_CSP, dashboardPage, itemPage, libraryPage, loginPage, messagePage, verifyPage } from "./views.js";
import { validEmail } from "../security.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const loadCatalog = () => JSON.parse(fs.readFileSync(path.join(here, "content", "catalog.json"), "utf8"));

const fail = (res, status, error) => res.status(status).json({ error, requestId: res.req.requestId });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => {
  console.error("Subscription route failed", { path: req.path, errorType: error?.name ?? "Error", code: error?.code, requestId: req.requestId });
  if (res.headersSent) return;
  if ((req.headers.accept ?? "").includes("text/html")) return res.status(500).send("Something went wrong. Please try again.");
  return fail(res, 500, "internal_error");
});

function parseIntent(source) {
  const plan = source?.plan; const interval = source?.interval;
  return typeof plan === "string" && typeof interval === "string" && offerFor(plan, interval) ? { plan, interval } : null;
}

/**
 * @param {object} deps  db, stripe, mailer, ctx (validated config), catalog
 */
export function createSubscriptionRouter({ db, stripe, mailer, ctx, catalog = loadCatalog() }) {
  const router = express.Router();
  router.use((req, _res, next) => { req.requestId ??= crypto.randomUUID(); next(); });

  router.use("/v1/subscriptions", (req, res, next) => {
    // Plan state is public, non-sensitive and fetched cross-origin by the static site (no credentials).
    if (ctx.siteOrigin && req.headers.origin === ctx.siteOrigin) {
      res.set({ "Access-Control-Allow-Origin": ctx.siteOrigin, Vary: "Origin", "Cross-Origin-Resource-Policy": "cross-origin" });
    }
    next();
  });

  router.get("/v1/subscriptions/plans", wrap(async (_req, res) => {
    res.set("Cache-Control", "public, max-age=60");
    if (!ctx.ok) return res.json({ configured: false, plans: [] });
    res.json({ configured: true, mode: ctx.mode, accountUrl: `${ctx.appOrigin}/account`, contactUrl: ctx.contactUrl, plans: await describeOffers(ctx, stripe) });
  }));

  router.use("/account", (req, res, next) => {
    res.set("Content-Security-Policy", PAGE_CSP);
    if (!ctx.ok) return res.status(503).type("text/plain").send("Membership accounts are not configured on this deployment.");
    next();
  });
  router.use("/account/assets", express.static(path.join(here, "public"), { maxAge: "5m", index: false }));

  const requireSameOrigin = (req, res, next) => {
    if (req.headers.origin !== ctx.appOrigin) return fail(res, 403, "untrusted_origin");
    next();
  };

  const sessionOptional = wrap(async (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME(ctx)];
    const session = token ? await loadSession(db, ctx, token) : null;
    req.account = session;
    next();
  });
  const requireSession = [sessionOptional, (req, res, next) => (req.account ? next() : fail(res, 401, "unauthenticated"))];
  const requireCsrf = (req, res, next) => (safeEqual(req.get("x-csrf-token"), csrfTokenFor(ctx.authSecret, req.account.sessionId)) ? next() : fail(res, 403, "csrf_failed"));
  const mutating = [requireSameOrigin, ...requireSession, requireCsrf];
  const json = express.json({ limit: "4kb" });

  // --- Passwordless sign-in ----------------------------------------------
  router.post("/account/api/auth/request", requireSameOrigin, json, wrap(async (req, res) => {
    if (!mailer) return fail(res, 503, "email_not_configured");
    const email = normalizeEmail(req.body?.email);
    if (!validEmail(email)) return fail(res, 400, "invalid_email");
    if (!(await consumeRateLimit(db, ctx, "auth_ip", req.ip, 20, 3600))) return fail(res, 429, "rate_limited");
    // Per-address limit answers identically so it cannot be used to probe accounts.
    if (await consumeRateLimit(db, ctx, "auth_email", email, 5, 900)) {
      const intent = parseIntent(req.body) ?? {};
      const token = await createChallenge(db, ctx, email, intent);
      const query = new URLSearchParams({ token });
      const link = `${ctx.appOrigin}/account/auth/verify?${query}`;
      try {
        await mailer.send({ to: email, ...loginEmail({ link, ttlMinutes: CHALLENGE_TTL_MINUTES }) });
      } catch (error) {
        console.error("Sign-in email delivery failed", { errorType: error?.name ?? "Error", code: error?.code });
        return fail(res, 502, "email_delivery_failed");
      }
    }
    res.status(202).json({ accepted: true });
  }));

  router.get("/account/auth/verify", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    res.set("Referrer-Policy", "no-referrer").type("html").send(verifyPage({ ctx, token }));
  });

  router.post("/account/auth/verify", requireSameOrigin, express.urlencoded({ extended: false, limit: "4kb" }), wrap(async (req, res) => {
    if (!(await consumeRateLimit(db, ctx, "auth_verify", req.ip, 30, 900))) return res.status(429).type("html").send(messagePage({ ctx, title: "Too many attempts", message: "Please wait a few minutes and try again." }));
    const result = await redeemChallenge(db, ctx, req.body?.token);
    if (!result) return res.status(400).type("html").send(messagePage({ ctx, title: "Link not valid", message: "This sign-in link is invalid, expired or already used. Request a new one." }));
    res.set("Set-Cookie", sessionCookie(ctx, result.sessionToken, SESSION_ABSOLUTE_SECONDS));
    const intent = parseIntent({ plan: result.plan, interval: result.interval });
    res.redirect(303, intent ? `/account?plan=${intent.plan}&interval=${intent.interval}` : "/account");
  }));

  router.post("/account/api/auth/logout", mutating, wrap(async (req, res) => {
    await revokeSession(db, req.account.sessionId);
    res.set("Set-Cookie", sessionCookie(ctx, "", 0));
    res.json({ ok: true });
  }));

  // --- Pages -----------------------------------------------------------------
  const page = (res, html) => res.set("Cache-Control", "no-store").type("html").send(html);

  router.get("/account", sessionOptional, wrap(async (req, res) => {
    if (!req.account) return page(res, loginPage({ ctx, intent: parseIntent(req.query), emailReady: Boolean(mailer) }));
    const entitlement = await loadEntitlement(db, req.account.userId, ctx);
    const checkout = req.query.checkout === "success" || req.query.checkout === "cancelled" ? req.query.checkout : null;
    page(res, dashboardPage({
      ctx, user: req.account, csrf: csrfTokenFor(ctx.authSecret, req.account.sessionId), entitlement,
      plans: await describeOffers(ctx, stripe), intent: parseIntent(req.query), checkout,
    }));
  }));

  router.get("/account/api/me", ...requireSession, wrap(async (req, res) => {
    const entitlement = await loadEntitlement(db, req.account.userId, ctx);
    res.json({ email: req.account.email, csrfToken: csrfTokenFor(ctx.authSecret, req.account.sessionId), entitlement: { active: entitlement.active, plan: entitlement.plan, until: entitlement.until } });
  }));

  // Server-authorised on every request: entitlement is recomputed from stored Stripe state and the clock.
  router.get("/account/library", sessionOptional, wrap(async (req, res) => {
    if (!req.account) return res.redirect(303, "/account");
    const entitlement = await loadEntitlement(db, req.account.userId, ctx);
    page(res, libraryPage({ ctx, csrf: csrfTokenFor(ctx.authSecret, req.account.sessionId), entitlement, catalog }));
  }));

  router.get("/account/library/:slug", sessionOptional, wrap(async (req, res) => {
    if (!req.account) return res.redirect(303, "/account");
    const entitlement = await loadEntitlement(db, req.account.userId, ctx);
    for (const area of catalog.areas) {
      const item = area.items.find((i) => i.slug === req.params.slug);
      if (!item) continue;
      if (!planAllows(entitlement, area.minPlan)) return res.status(403).type("html").send(messagePage({ ctx, title: "Membership required", message: "Your current membership does not include this content." }));
      return page(res, itemPage({ ctx, csrf: csrfTokenFor(ctx.authSecret, req.account.sessionId), item }));
    }
    res.status(404).type("html").send(messagePage({ ctx, title: "Not found", message: "That item does not exist." }));
  }));

  // --- Billing -------------------------------------------------------------------
  async function ensureCustomer(user) {
    const existing = (await db.query("select stripe_customer_id from stripe_customers where user_id = $1 and livemode = $2", [user.userId, ctx.livemode])).rows[0];
    if (existing) return existing.stripe_customer_id;
    const customer = await stripe.customers.create(
      { email: user.email, metadata: { user_id: user.userId, environment: ctx.environment, source: "clearglass-membership" } },
      { idempotencyKey: `cg-customer-${ctx.environment}-${user.userId}` },
    );
    await db.query("insert into stripe_customers (user_id, stripe_customer_id, livemode) values ($1,$2,$3) on conflict do nothing", [user.userId, customer.id, ctx.livemode]);
    return (await db.query("select stripe_customer_id from stripe_customers where user_id = $1 and livemode = $2", [user.userId, ctx.livemode])).rows[0].stripe_customer_id;
  }

  router.post("/account/api/billing/checkout", mutating, json, wrap(async (req, res) => {
    const plan = req.body?.plan; const interval = req.body?.interval;
    const offerDef = typeof plan === "string" && typeof interval === "string" ? offerFor(plan, interval) : null;
    if (!offerDef) return fail(res, 400, "invalid_plan");
    const offer = ctx.offers.get(offerDef.id);
    if (!offer.priceId) return fail(res, 409, plan === "northstar" ? "contact_required" : "plan_unavailable");
    if (!(await consumeRateLimit(db, ctx, "checkout", req.account.userId, 10, 3600))) return fail(res, 429, "rate_limited");
    if ((await loadEntitlement(db, req.account.userId, ctx)).active) return fail(res, 409, "already_subscribed");

    const price = await stripe.prices.retrieve(offer.priceId);
    const intervalOk = !offerDef.stripeInterval || (price.recurring?.interval === offerDef.stripeInterval && price.recurring?.interval_count === 1);
    if (!price.active || price.type !== "recurring" || price.livemode !== ctx.livemode || !intervalOk) return fail(res, 409, "plan_unavailable");

    const customer = await ensureCustomer(req.account);
    const metadata = { user_id: req.account.userId, plan_key: plan, billing_interval: interval, environment: ctx.environment, source: "clearglass-membership" };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: req.account.userId,
      line_items: [{ price: offer.priceId, quantity: 1 }],
      metadata,
      subscription_data: { metadata },
      success_url: `${ctx.appOrigin}/account?checkout=success`,
      cancel_url: `${ctx.appOrigin}/account?checkout=cancelled`,
      customer_update: ctx.automaticTax ? { address: "auto", name: "auto" } : undefined,
      automatic_tax: ctx.automaticTax ? { enabled: true } : undefined,
    }, { idempotencyKey: `cg-checkout-${req.account.userId}-${offerDef.id}-${Math.floor(Date.now() / 600_000)}` });
    await db.query("insert into billing_audit (user_id, action, detail) values ($1, 'checkout_started', $2)", [req.account.userId, JSON.stringify({ offer: offerDef.id, sessionId: session.id })]);
    res.status(201).json({ url: session.url });
  }));

  router.post("/account/api/billing/portal", mutating, wrap(async (req, res) => {
    if (!(await consumeRateLimit(db, ctx, "portal", req.account.userId, 20, 3600))) return fail(res, 429, "rate_limited");
    const mapping = (await db.query("select stripe_customer_id from stripe_customers where user_id = $1 and livemode = $2", [req.account.userId, ctx.livemode])).rows[0];
    if (!mapping) return fail(res, 404, "no_billing_account");
    const session = await stripe.billingPortal.sessions.create({
      customer: mapping.stripe_customer_id,
      return_url: `${ctx.appOrigin}/account`,
      configuration: ctx.portalConfigurationId,
    });
    await db.query("insert into billing_audit (user_id, action) values ($1, 'portal_opened')", [req.account.userId]);
    res.status(201).json({ url: session.url });
  }));

  router.post("/account/api/billing/refresh", mutating, wrap(async (req, res) => {
    if (!(await consumeRateLimit(db, ctx, "refresh", req.account.userId, 20, 3600))) return fail(res, 429, "rate_limited");
    const result = await syncUserSubscriptions({ db, stripe, ctx, userId: req.account.userId });
    const entitlement = await loadEntitlement(db, req.account.userId, ctx);
    res.json({ result: result.status, entitlement: { active: entitlement.active, plan: entitlement.plan, until: entitlement.until } });
  }));

  return router;
}
