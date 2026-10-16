/**
 * Validate a Checkout Price against the server-owned allowlist and the configured
 * Stripe key mode. Client-supplied price IDs never establish price or mode.
 */
export function isApprovedCheckoutPrice(price, requestedPriceId, allowedPriceIds, apiKey) {
  if (!price || price.active !== true || typeof price.id !== "string" ||
      price.id !== requestedPriceId || !allowedPriceIds?.has(requestedPriceId)) {
    return false;
  }

  const keyMode = typeof apiKey === "string" && /^(?:sk|rk)_(?:test|live)_/.test(apiKey)
    ? (/^(?:sk|rk)_live_/.test(apiKey) ? "live" : "test")
    : null;
  if (!keyMode || Boolean(price.livemode) !== (keyMode === "live")) return false;

  if (price.recurring) return price.type === "recurring";
  return price.type === "one_time";
}

export function resolveCheckoutMode(price) {
  if (!price || price.active !== true) {
    throw new TypeError("An active Stripe Price is required");
  }
  if (price.type === "recurring" && price.recurring) return "subscription";
  if (price.type === "one_time" && !price.recurring) return "payment";
  throw new TypeError("Stripe Price has an unsupported or inconsistent billing type");
}
