import { PLANS, planByKey } from "./config.js";

const ACTIVE_FOR_ACCESS = new Set(["active"]);

/**
 * Decide whether one stored (Stripe-verified) subscription currently grants access.
 * Pure: depends only on the row, the clock and policy. cancel_at_period_end stays
 * valid only until the verified period end.
 */
export function evaluateSubscription(row, now, policy) {
  const deny = (reason) => ({ entitled: false, reason });
  if (!row) return deny("missing");
  if (row.deleted_at) return deny("deleted");
  if (!planByKey(row.plan_key)) return deny("unknown_plan");
  if (row.livemode !== policy.livemode) return deny("mode_mismatch");
  const trialing = row.status === "trialing";
  if (!ACTIVE_FOR_ACCESS.has(row.status) && !(trialing && policy.trialAccess)) {
    return deny(trialing ? "trial_not_permitted" : `status_${row.status}`);
  }
  if (!row.current_period_end) return deny("no_verified_period_end");
  const end = new Date(row.current_period_end).getTime();
  if (!(end + policy.graceSeconds * 1000 > now.getTime())) return deny("period_ended");
  if (!trialing) {
    // Paid-vs-active: an "active" subscription whose first invoice is not paid is not access.
    const invoice = row.latest_invoice_status;
    if (invoice === "uncollectible" || invoice === "void") return deny("invoice_" + invoice);
    if (invoice && invoice !== "paid" && row.latest_invoice_reason === "subscription_create") return deny("first_payment_unconfirmed");
  }
  return { entitled: true, reason: "ok" };
}

/** Union across subscriptions: highest plan wins, access lasts to the latest qualifying period end. */
export function resolveEntitlement(rows, now, policy) {
  let best = null;
  const subscriptions = [];
  for (const row of rows) {
    const result = evaluateSubscription(row, now, policy);
    const plan = planByKey(row.plan_key);
    subscriptions.push({
      id: row.stripe_subscription_id, plan: row.plan_key, status: row.status,
      entitled: result.entitled, reason: result.reason,
      currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    });
    if (!result.entitled) continue;
    const until = new Date(row.current_period_end).getTime();
    if (!best || plan.tier > best.plan.tier) best = { plan, until };
    else if (plan.tier === best.plan.tier) best.until = Math.max(best.until, until);
  }
  const areas = best ? PLANS.filter((p) => p.tier <= best.plan.tier).flatMap((p) => p.areas) : [];
  return {
    active: Boolean(best),
    plan: best?.plan.key ?? null,
    tier: best?.plan.tier ?? 0,
    until: best ? new Date(best.until).toISOString() : null,
    areas,
    subscriptions,
  };
}

export async function loadEntitlement(db, userId, ctx, now = new Date()) {
  const { rows } = await db.query("select * from subscriptions where user_id = $1", [userId]);
  return resolveEntitlement(rows, now, ctx);
}

export const planAllows = (entitlement, minPlan) => {
  const required = planByKey(minPlan);
  return Boolean(required && entitlement.active && entitlement.tier >= required.tier);
};
