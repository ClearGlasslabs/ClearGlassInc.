import crypto from "node:crypto";
import { planByKey } from "./config.js";
import { resolveEntitlement } from "./entitlements.js";

export const SUBSCRIPTION_EVENT_TYPES = Object.freeze([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

const idOf = (value) => (typeof value === "string" && value ? value : (value && typeof value.id === "string" ? value.id : null));
const toDate = (seconds) => (Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null);

function subscriptionIdFromInvoice(invoice) {
  return idOf(invoice?.subscription) ??
    idOf(invoice?.parent?.subscription_details?.subscription) ??
    idOf(invoice?.subscription_details?.subscription) ?? null;
}

/** Maps a canonical Stripe subscription onto a membership plan using the server-side price allowlist only. */
export function describeSubscription(subscription, ctx) {
  const items = subscription.items?.data ?? [];
  let match = null;
  for (const item of items) {
    const offer = ctx.priceMap.get(idOf(item.price));
    if (!offer) continue;
    if (!match || planByKey(offer.plan).tier > planByKey(match.plan).tier) match = offer;
  }
  const periodEnds = items.map((i) => i.current_period_end).filter(Number.isFinite);
  const periodEnd = Number.isFinite(subscription.current_period_end)
    ? subscription.current_period_end
    : (periodEnds.length ? Math.max(...periodEnds) : null);
  const invoice = subscription.latest_invoice && typeof subscription.latest_invoice === "object" ? subscription.latest_invoice : null;
  return {
    planKey: match?.plan ?? null,
    interval: match?.interval ?? null,
    priceId: match?.priceId ?? null,
    status: subscription.status,
    currentPeriodEnd: toDate(periodEnd),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    cancelAt: toDate(subscription.cancel_at),
    trialEnd: toDate(subscription.trial_end),
    invoiceStatus: invoice?.status ?? null,
    invoiceReason: invoice?.billing_reason ?? null,
    livemode: Boolean(subscription.livemode),
    customerId: idOf(subscription.customer),
    metadataUserId: subscription.metadata?.user_id ?? null,
  };
}

async function audit(tx, { eventId = null, userId = null, action, detail = {} }) {
  await tx.query("insert into billing_audit (event_id, user_id, action, detail) values ($1, $2, $3, $4)", [eventId, userId, action, JSON.stringify(detail)]);
}

async function upsertSubscription(tx, ctx, event, subscriptionId, described, verifiedAt, deleted) {
  const mapping = described.customerId
    ? (await tx.query("select user_id from stripe_customers where stripe_customer_id = $1 and livemode = $2", [described.customerId, ctx.livemode])).rows[0]
    : null;
  if (!mapping) {
    await audit(tx, { eventId: event.id, action: "subscription_unlinked", detail: { subscriptionId } });
    return null;
  }
  // Metadata is only a cross-check; the customer mapping created server-side is authoritative.
  if (described.metadataUserId && described.metadataUserId !== mapping.user_id) {
    await audit(tx, { eventId: event.id, userId: mapping.user_id, action: "subscription_linkage_mismatch", detail: { subscriptionId } });
    return null;
  }
  const status = deleted ? "canceled" : described.status;
  const result = await tx.query(
    `insert into subscriptions (stripe_subscription_id, user_id, stripe_customer_id, plan_key, billing_interval, price_id, status,
       current_period_end, cancel_at_period_end, cancel_at, trial_end, latest_invoice_status, latest_invoice_reason, livemode,
       deleted_at, last_event_id, last_verified_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     on conflict (stripe_subscription_id) do update set
       plan_key = excluded.plan_key, billing_interval = excluded.billing_interval, price_id = excluded.price_id,
       status = excluded.status, current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end, cancel_at = excluded.cancel_at, trial_end = excluded.trial_end,
       latest_invoice_status = excluded.latest_invoice_status, latest_invoice_reason = excluded.latest_invoice_reason,
       livemode = excluded.livemode, deleted_at = coalesce(subscriptions.deleted_at, excluded.deleted_at),
       last_event_id = excluded.last_event_id, last_verified_at = excluded.last_verified_at, updated_at = now()
     where subscriptions.last_verified_at <= excluded.last_verified_at
       and subscriptions.user_id = excluded.user_id
       and (subscriptions.status not in ('canceled','incomplete_expired') or excluded.status in ('canceled','incomplete_expired'))
     returning stripe_subscription_id`,
    [subscriptionId, mapping.user_id, described.customerId, described.planKey, described.interval, described.priceId, status,
      described.currentPeriodEnd, described.cancelAtPeriodEnd, described.cancelAt, described.trialEnd,
      described.invoiceStatus, described.invoiceReason, described.livemode,
      deleted ? verifiedAt : null, event.id, verifiedAt],
  );
  await audit(tx, {
    eventId: event.id, userId: mapping.user_id,
    action: result.rowCount ? "subscription_synced" : "subscription_stale_ignored",
    detail: { subscriptionId, status, plan: described.planKey },
  });
  return mapping.user_id;
}

async function refreshEntitlement(tx, ctx, userId, eventId) {
  const { rows } = await tx.query("select * from subscriptions where user_id = $1", [userId]);
  const entitlement = resolveEntitlement(rows, new Date(), ctx);
  await tx.query(
    `insert into entitlements (user_id, plan_key, active_until, source_event_id) values ($1,$2,$3,$4)
     on conflict (user_id) do update set plan_key = excluded.plan_key, active_until = excluded.active_until,
       source_event_id = excluded.source_event_id, updated_at = now()`,
    [userId, entitlement.plan, entitlement.until, eventId],
  );
}

/**
 * Persists canonical subscription states for one event (or manual sync) in a single transaction
 * together with event idempotency, audit rows and entitlement summaries.
 * `items` is [{ id, subscription, deleted, verifiedAt }] of Stripe-verified objects.
 */
export async function persistCanonicalSubscriptions({ db, ctx, event, items, note }) {
  return db.tx(async (tx) => {
    const inserted = await tx.query(
      `insert into stripe_events (event_id, event_type, livemode, stripe_created_at) values ($1,$2,$3,$4)
       on conflict (event_id) do nothing returning event_id`,
      [event.id, event.type, Boolean(event.livemode), toDate(event.created)],
    );
    if (!inserted.rowCount) return { status: "duplicate" };
    const users = new Set();
    for (const item of items) {
      if (item.subscription.livemode !== ctx.livemode) throw new Error("Stripe object mode does not match configured key mode");
      const described = describeSubscription(item.subscription, ctx);
      const userId = await upsertSubscription(tx, ctx, event, item.id, described, item.verifiedAt, item.deleted);
      if (userId) users.add(userId);
    }
    for (const userId of users) await refreshEntitlement(tx, ctx, userId, event.id);
    if (!items.length) await audit(tx, { eventId: event.id, action: note ?? "event_without_subscription" });
    return { status: "processed", users: users.size };
  });
}

async function retrieveSubscription(stripe, id) {
  const verifiedAt = new Date();
  try {
    const subscription = await stripe.subscriptions.retrieve(id, { expand: ["latest_invoice"] });
    return { id, subscription, verifiedAt, deleted: subscription.status === "canceled" && Boolean(subscription.ended_at) };
  } catch (error) {
    if (error?.code === "resource_missing") return null;
    throw error;
  }
}

/** Apply a verified Stripe event: canonical fetch, then one PG transaction (idempotent). */
export async function applySubscriptionEvent({ db, stripe, ctx, event }) {
  if (!SUBSCRIPTION_EVENT_TYPES.includes(event?.type)) return { status: "ignored" };
  const object = event.data?.object ?? {};
  let subscriptionId = null;
  let fallback = null;

  if (event.type === "checkout.session.completed") {
    const session = await stripe.checkout.sessions.retrieve(object.id);
    if (session.mode !== "subscription") return persistCanonicalSubscriptions({ db, ctx, event, items: [], note: "checkout_not_subscription" });
    subscriptionId = idOf(session.subscription);
  } else if (event.type.startsWith("customer.subscription.")) {
    subscriptionId = idOf(object);
    if (event.type.endsWith(".deleted")) fallback = object;
  } else {
    subscriptionId = subscriptionIdFromInvoice(object);
  }

  const items = [];
  if (subscriptionId) {
    const verified = await retrieveSubscription(stripe, subscriptionId);
    if (verified) items.push(verified);
    else if (fallback) items.push({ id: subscriptionId, subscription: { ...fallback, status: "canceled" }, verifiedAt: new Date(), deleted: true });
  }
  return persistCanonicalSubscriptions({ db, ctx, event, items });
}

/** User-initiated reconciliation against Stripe for the trusted mapped customer only. */
export async function syncUserSubscriptions({ db, stripe, ctx, userId }) {
  const mapping = (await db.query("select stripe_customer_id from stripe_customers where user_id = $1 and livemode = $2", [userId, ctx.livemode])).rows[0];
  if (!mapping) return { status: "no_customer" };
  const verifiedAt = new Date();
  const list = await stripe.subscriptions.list({ customer: mapping.stripe_customer_id, status: "all", limit: 20, expand: ["data.latest_invoice"] });
  const items = list.data.map((subscription) => ({
    id: subscription.id, subscription, verifiedAt,
    deleted: subscription.status === "canceled" && Boolean(subscription.ended_at),
  }));
  const event = { id: `manual_sync_${crypto.randomUUID()}`, type: "manual.sync", livemode: ctx.livemode, created: Math.floor(Date.now() / 1000) };
  return persistCanonicalSubscriptions({ db, ctx, event, items, note: "manual_sync_no_subscriptions" });
}
