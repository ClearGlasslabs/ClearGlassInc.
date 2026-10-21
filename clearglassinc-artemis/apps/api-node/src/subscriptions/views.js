import { planByKey } from "./config.js";

export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

export function layout({ title, body, csrf = null, ctx }) {
  const site = ctx?.siteOrigin ?? "/";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">${csrf ? `<meta name="csrf-token" content="${esc(csrf)}">` : ""}<title>${esc(title)} | ClearGlassInc membership</title><link rel="stylesheet" href="/account/assets/account.css"><script defer src="/account/assets/account.js"></script></head><body><a class="skip" href="#main">Skip to content</a><header class="bar"><a class="brand" href="${esc(site)}"><span class="mark">CG</span><span>CLEARGLASS<span>INC</span></span></a><nav aria-label="Account">${csrf ? `<a href="/account">Account</a><a href="/account/library">Library</a><button type="button" class="link" data-action="logout">Sign out</button>` : ""}</nav></header><main id="main" tabindex="-1">${body}<p class="status" role="status" aria-live="polite" data-status></p></main><footer><p>Membership access is verified by the server on every request.</p></footer></body></html>`;
}

export function loginPage({ ctx, intent, notice, emailReady }) {
  const hidden = intent ? `<input type="hidden" name="plan" value="${esc(intent.plan)}"><input type="hidden" name="interval" value="${esc(intent.interval)}">` : "";
  const plan = intent ? planByKey(intent.plan) : null;
  return layout({ ctx, title: "Sign in", body: `<section class="panel narrow"><p class="kicker">MEMBERSHIP</p><h1>Sign in with email</h1>${plan ? `<p>You selected <strong>${esc(plan.name)}</strong>. Sign in first; checkout starts only after you confirm.</p>` : ""}${notice ? `<p class="notice">${esc(notice)}</p>` : ""}${emailReady ? "" : `<p class="notice" role="alert">Sign-in email is not configured on this deployment, so sign-in is unavailable.</p>`}<form data-form="login" method="post" action="/account/api/auth/request"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254">${hidden}<button class="button primary" type="submit"${emailReady ? "" : " disabled"}>Email me a sign-in link</button></form><p class="fine">We email a single-use link that expires in 15 minutes. No password is needed.</p><noscript><p class="notice">JavaScript is required for this form.</p></noscript></section>` });
}

export function verifyPage({ ctx, token }) {
  return layout({ ctx, title: "Confirm sign-in", body: `<section class="panel narrow"><h1>Confirm sign-in</h1><p>Select the button to finish signing in on this device.</p><form method="post" action="/account/auth/verify"><input type="hidden" name="token" value="${esc(token)}"><button class="button primary" type="submit">Sign in</button></form></section>` });
}

export function messagePage({ ctx, title, message }) {
  return layout({ ctx, title, body: `<section class="panel narrow"><h1>${esc(title)}</h1><p>${esc(message)}</p><p><a class="button ghost" href="/account">Back to account</a></p></section>` });
}

const INTERVAL_LABEL = { monthly: "Monthly", annual: "Annual", enterprise: "Enterprise" };

function offerControl(plan, offer, entitled, ctx) {
  if (offer.state === "contact") return `<p class="fine">Northstar access is arranged with our team.</p><a class="button ghost" href="${esc(ctx.contactUrl)}">Request access</a>`;
  if (offer.state === "unconfigured") return `<p class="fine">${INTERVAL_LABEL[offer.interval]}: not yet configured.</p>`;
  if (offer.state === "unavailable") return `<p class="fine">${INTERVAL_LABEL[offer.interval]}: currently unavailable.</p>`;
  const price = offer.amount ? `${esc(offer.amount)} / ${offer.interval === "annual" ? "year" : offer.interval === "monthly" ? "month" : "term"}` : "Price shown at checkout";
  return `<div class="offer"><span>${INTERVAL_LABEL[offer.interval]}: ${price}</span><button type="button" class="button dark" data-checkout-plan="${esc(plan.key)}" data-checkout-interval="${esc(offer.interval)}"${entitled ? " disabled" : ""}>Subscribe${plan.key === "northstar" ? "" : ` ${esc(INTERVAL_LABEL[offer.interval].toLowerCase())}`}</button></div>`;
}

export function dashboardPage({ ctx, user, csrf, entitlement, plans, intent, checkout }) {
  const current = entitlement.active ? planByKey(entitlement.plan) : null;
  const status = current
    ? `<p class="notice ok">Active: <strong>${esc(current.name)}</strong> through ${esc(entitlement.until.slice(0, 10))}${entitlement.subscriptions.some((s) => s.entitled && s.cancelAtPeriodEnd) ? " (set to end at that date)" : ""}.</p>`
    : `<p class="notice">No active membership on this account.</p>`;
  const checkoutNote = checkout === "success"
    ? `<p class="notice" data-checkout-return="success">Returning from Stripe. Access is granted only when Stripe confirms payment to our server; checking now…</p>`
    : checkout === "cancelled" ? `<p class="notice">Checkout was cancelled. You have not been charged.</p>` : "";
  const cards = plans.map((plan) => `<article class="card${intent?.plan === plan.key ? " highlight" : ""}" aria-labelledby="plan-${esc(plan.key)}"><h3 id="plan-${esc(plan.key)}">${esc(plan.name)}</h3><p>${esc(plan.summary)}</p><ul>${plan.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>${plan.offers.map((o) => offerControl(plan, o, false, ctx)).join("")}</article>`).join("");
  const billing = `<div class="actions"><button type="button" class="button primary" data-action="portal">Manage billing</button><button type="button" class="button ghost" data-action="refresh">Refresh status from Stripe</button></div>`;
  return layout({ ctx, title: "Account", csrf, body: `<section class="panel"><p class="kicker">ACCOUNT</p><h1>Your membership</h1><p>Signed in as <strong>${esc(user.email)}</strong>.</p>${checkoutNote}${status}${billing}</section><section class="panel"><h2>Plans</h2><div class="cards">${cards}</div><p class="fine">Prices come from Stripe and exclude applicable taxes. Checkout and card entry happen on Stripe-hosted pages.</p></section>` });
}

export function libraryPage({ ctx, csrf, entitlement, catalog }) {
  const rank = (key) => planByKey(key).tier;
  const sections = catalog.areas.map((area) => {
    const allowed = entitlement.active && entitlement.tier >= rank(area.minPlan);
    if (!allowed) return `<article class="card locked"><h3>${esc(area.title)}</h3><p>Included in ${esc(planByKey(area.minPlan).name)} and above.</p></article>`;
    const items = area.items.length
      ? `<ul>${area.items.map((i) => `<li><a href="/account/library/${esc(i.slug)}">${esc(i.title)}</a>${i.summary ? ` — ${esc(i.summary)}` : ""}</li>`).join("")}</ul>`
      : `<p class="notice">Not yet published. Content appears here when it is released; membership does not promise a publishing schedule.</p>`;
    return `<article class="card"><h3>${esc(area.title)}</h3>${items}</article>`;
  }).join("");
  const lead = entitlement.active ? "" : `<p class="notice" role="alert">An active membership is required to read subscriber content.</p>`;
  return layout({ ctx, title: "Library", csrf, body: `<section class="panel"><p class="kicker">SUBSCRIBER AREA</p><h1>Library</h1>${lead}<div class="cards">${sections}</div></section>` });
}

export function itemPage({ ctx, csrf, item }) {
  const paragraphs = String(item.body ?? "").split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("");
  return layout({ ctx, title: item.title, csrf, body: `<article class="panel"><p class="kicker"><a href="/account/library">LIBRARY</a></p><h1>${esc(item.title)}</h1>${paragraphs}</article>` });
}
