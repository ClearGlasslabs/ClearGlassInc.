import { PLANS, OFFERS } from "./config.js";

const CACHE_MS = 300_000;
let cache = { key: "", at: 0, value: null };

function formatAmount(unitAmount, currency) {
  if (!Number.isInteger(unitAmount) || typeof currency !== "string") return null;
  const upper = currency.toUpperCase();
  try {
    const fmt = new Intl.NumberFormat("en-CA", { style: "currency", currency: upper });
    const digits = fmt.resolvedOptions().maximumFractionDigits;
    return fmt.format(unitAmount / 10 ** digits);
  } catch { return null; }
}

/**
 * Public, non-secret plan state. Amounts come only from the configured Stripe
 * Price; unconfigured or unreadable prices are reported as such, never guessed.
 */
export async function describeOffers(ctx, stripe, now = Date.now()) {
  const cacheKey = [...ctx.priceMap.keys()].sort().join(",");
  if (cache.value && cache.key === cacheKey && now - cache.at < CACHE_MS) return cache.value;
  const states = new Map();
  for (const offer of OFFERS) {
    const configured = ctx.offers.get(offer.id);
    if (!configured?.priceId) { states.set(offer.id, { state: offer.plan === "northstar" ? "contact" : "unconfigured" }); continue; }
    try {
      const price = await stripe.prices.retrieve(configured.priceId);
      const ok = price.active && price.type === "recurring" && price.livemode === ctx.livemode &&
        (!offer.stripeInterval || price.recurring?.interval === offer.stripeInterval) && (offer.interval === "enterprise" || price.recurring?.interval_count === 1);
      states.set(offer.id, ok
        ? { state: "available", amount: formatAmount(price.unit_amount, price.currency), currency: price.currency }
        : { state: "unavailable" });
    } catch {
      states.set(offer.id, { state: "unavailable" });
    }
  }
  const value = PLANS.map((plan) => ({
    key: plan.key, name: plan.name, summary: plan.summary, features: plan.features,
    offers: OFFERS.filter((o) => o.plan === plan.key).map((o) => ({ id: o.id, interval: o.interval, ...states.get(o.id) })),
  }));
  cache = { key: cacheKey, at: now, value };
  return value;
}

export const resetOfferCache = () => { cache = { key: "", at: 0, value: null }; };
