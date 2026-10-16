const PROCESSED_EVENT_TTL_SECONDS = 31_536_000;

const APPLY_BILLING_EFFECTS_SCRIPT = [
  "if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end",
  "local offset = 4",
  "for i = 2, #KEYS do",
  "  local incomingCreated = tonumber(ARGV[offset]) or 0",
  "  local incomingRank = tonumber(ARGV[offset + 1]) or 0",
  "  local incomingEventId = ARGV[offset + 2]",
  "  local incomingJson = ARGV[offset + 3]",
  "  local existingJson = redis.call('GET', KEYS[i])",
  "  local shouldWrite = false",
  "  if not existingJson then",
  "    shouldWrite = true",
  "  else",
  "    local existing = cjson.decode(existingJson)",
  "    local existingCreated = tonumber(existing.eventCreated) or 0",
  "    local existingRank = tonumber(existing._terminalRank) or 0",
  "    local existingEventId = tostring(existing.eventId or '')",
  "    if incomingCreated > existingCreated then",
  "      shouldWrite = true",
  "    elseif incomingCreated == existingCreated and incomingRank > existingRank then",
  "      shouldWrite = true",
  "    elseif incomingCreated == existingCreated and incomingRank == existingRank and incomingEventId > existingEventId then",
  "      shouldWrite = true",
  "    end",
  "  end",
  "  if shouldWrite then redis.call('SET', KEYS[i], incomingJson) end",
  "  offset = offset + 4",
  "end",
  "redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[3]))",
  "return 1",
].join("\n");

function idOf(value) {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof value.id === "string") return value.id;
  return null;
}

function unixSeconds(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function priceIdsOf(subscription) {
  return Array.isArray(subscription?.items?.data)
    ? subscription.items.data
        .map((item) => idOf(item?.price))
        .filter(Boolean)
    : [];
}

function createRecord(kind, id, state, event, rank = 0) {
  if (!id) return null;
  return {
    key: "billing:stripe:" + kind + ":" + id,
    rank,
    state: {
      ...state,
      recordType: kind,
      stripeObjectId: id,
      eventId: event.id,
      eventType: event.type,
      eventCreated: unixSeconds(event.created) ?? 0,
      _terminalRank: rank,
    },
  };
}

function normalizeSubscription(subscription, event, terminal = false) {
  const subId = idOf(subscription);
  if (!subId) return null;

  const status = terminal ? "canceled" : (subscription.status ?? "unknown");
  const itemPeriodEnds = (subscription.items?.data ?? [])
    .map((item) => unixSeconds(item.current_period_end))
    .filter(Boolean);
  const currentPeriodEnd = unixSeconds(subscription.current_period_end) ??
    (itemPeriodEnds.length ? Math.max(...itemPeriodEnds) : null);
  const currentPeriodStart = unixSeconds(subscription.current_period_start) ??
    (subscription.items?.data ?? [])
      .map((item) => unixSeconds(item.current_period_start))
      .filter(Boolean)
      .reduce((max, value) => Math.max(max, value), 0) || null;

  return createRecord("subscription", subId, {
    stripeCustomerId: idOf(subscription.customer),
    status,
    priceIds: priceIdsOf(subscription),
    currentPeriodStart,
    currentPeriodEnd,
    trialEnd: unixSeconds(subscription.trial_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    cancelAt: unixSeconds(subscription.cancel_at),
    canceledAt: unixSeconds(subscription.canceled_at),
    endedAt: unixSeconds(subscription.ended_at),
    collectionMethod: subscription.collection_method ?? null,
    billingAccessState: "unlinked",
    identityLinkRequired: true,
    // This ledger is not an authorization system. An authenticated principal-to-customer
    // mapping must be added before premium access can be granted.
  }, event, terminal ? 2 : (subscription.cancel_at_period_end ? 1 : 0));
}

function subscriptionIdFromInvoice(invoice) {
  return idOf(invoice?.subscription) ??
    idOf(invoice?.parent?.subscription_details?.subscription) ??
    idOf(invoice?.subscription_details?.subscription) ??
    null;
}

async function getCanonicalSubscription(stripeClient, id) {
  if (!id || typeof stripeClient?.subscriptions?.retrieve !== "function") return null;
  return stripeClient.subscriptions.retrieve(id);
}

async function getCanonicalInvoice(stripeClient, invoice) {
  if (!invoice?.id || typeof stripeClient?.invoices?.retrieve !== "function") return invoice;
  return stripeClient.invoices.retrieve(invoice.id);
}

/**
 * Convert a verified Stripe event into minimal, idempotent ledger writes.
 * Stripe reads are intentional: invoice and subscription events can arrive out of
 * order, so the worker stores canonical object state when the API can retrieve it.
 */
export async function buildStripeBillingEffects(event, stripeClient) {
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") {
    throw new TypeError("A verified Stripe event with id and type is required");
  }
  const object = event.data?.object;
  if (!object || typeof object !== "object") {
    throw new TypeError("Stripe event data.object is required");
  }

  const records = [];
  const push = (record) => { if (record) records.push(record); };

  if (event.type === "checkout.session.completed") {
    let session = object;
    if (session.id && typeof stripeClient?.checkout?.sessions?.retrieve === "function") {
      session = await stripeClient.checkout.sessions.retrieve(session.id);
    }

    const subscriptionId = idOf(session.subscription);
    push(createRecord("checkout", idOf(session), {
      stripeCustomerId: idOf(session.customer),
      subscriptionId,
      mode: session.mode ?? null,
      status: session.status ?? null,
      paymentStatus: session.payment_status ?? "unpaid",
      currency: session.currency ?? null,
      amountTotal: Number.isFinite(session.amount_total) ? session.amount_total : null,
      // client_reference_id is caller-provided and is deliberately not trusted as a principal.
      callerReferencePresent: typeof session.client_reference_id === "string" &&
        session.client_reference_id.length > 0,
      billingAccessState: "unlinked",
      identityLinkRequired: true,
    }, event, session.payment_status === "paid" ? 2 : 0));

    if (subscriptionId) {
      const subscription = await getCanonicalSubscription(stripeClient, subscriptionId);
      if (subscription) push(normalizeSubscription(subscription, event));
    }
  } else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const invoice = await getCanonicalInvoice(stripeClient, object);
    const subscriptionId = subscriptionIdFromInvoice(invoice);
    const canonicalSubscription = await getCanonicalSubscription(stripeClient, subscriptionId);
    const outcome = invoice.status === "paid" || event.type === "invoice.paid"
      ? "paid"
      : "payment_failed";

    push(createRecord("invoice", idOf(invoice), {
      stripeCustomerId: idOf(invoice.customer),
      subscriptionId,
      status: invoice.status ?? null,
      paymentOutcome: outcome,
      billingReason: invoice.billing_reason ?? null,
      currency: invoice.currency ?? null,
      amountDue: Number.isFinite(invoice.amount_due) ? invoice.amount_due : null,
      amountPaid: Number.isFinite(invoice.amount_paid) ? invoice.amount_paid : null,
      amountRemaining: Number.isFinite(invoice.amount_remaining) ? invoice.amount_remaining : null,
      attemptCount: Number.isFinite(invoice.attempt_count) ? invoice.attempt_count : null,
      periodStart: unixSeconds(invoice.period_start),
      periodEnd: unixSeconds(invoice.period_end),
      nextPaymentAttempt: unixSeconds(invoice.next_payment_attempt),
    }, event, outcome === "paid" ? 2 : 1));

    if (canonicalSubscription) push(normalizeSubscription(canonicalSubscription, event));
  } else if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const terminal = event.type === "customer.subscription.deleted";
    const subscription = terminal
      ? object
      : (await getCanonicalSubscription(stripeClient, idOf(object))) ?? object;
    push(normalizeSubscription(subscription, event, terminal));
  } else if (event.type === "charge.dispute.created") {
    let dispute = object;
    const chargeId = idOf(dispute.charge);
    let charge = typeof dispute.charge === "object" ? dispute.charge : null;
    if (chargeId && typeof stripeClient?.charges?.retrieve === "function") {
      charge = await stripeClient.charges.retrieve(chargeId);
    }

    const customerId = idOf(charge?.customer) ?? idOf(dispute.customer);
    const paymentIntentId = idOf(dispute.payment_intent) ?? idOf(charge?.payment_intent);
    push(createRecord("dispute", idOf(dispute), {
      stripeCustomerId: customerId,
      chargeId,
      paymentIntentId,
      status: dispute.status ?? "needs_review",
      reason: dispute.reason ?? null,
      currency: dispute.currency ?? charge?.currency ?? null,
      amount: Number.isFinite(dispute.amount) ? dispute.amount : null,
      evidenceDueBy: unixSeconds(dispute.evidence_details?.due_by),
      reviewRequired: true,
      // A dispute is recorded for review; access is not globally revoked without an explicit policy.
    }, event, 1));

    if (customerId) {
      push(createRecord("customer-risk", customerId, {
        stripeCustomerId: customerId,
        disputeReviewRequired: true,
        latestDisputeId: idOf(dispute),
        latestDisputeReason: dispute.reason ?? null,
      }, event, 1));
    }
  }

  return {
    eventId: event.id,
    eventType: event.type,
    eventCreated: unixSeconds(event.created) ?? 0,
    records,
  };
}

/**
 * Apply a consumer event and all of its billing-ledger changes in one Redis Lua
 * transaction. If the worker crashes before XACK, replay sees the event marker
 * and cannot apply the business effects twice.
 */
export async function applyStripeBillingEffects(
  redisClient,
  effects,
  { processedEventTtlSeconds = PROCESSED_EVENT_TTL_SECONDS } = {},
) {
  if (!redisClient || typeof redisClient.eval !== "function") {
    throw new TypeError("A Redis client with eval support is required");
  }
  if (!effects || typeof effects.eventId !== "string" || !Array.isArray(effects.records)) {
    throw new TypeError("Valid Stripe billing effects are required");
  }
  if (!Number.isSafeInteger(processedEventTtlSeconds) || processedEventTtlSeconds < 60) {
    throw new RangeError("Processed-event TTL must be an integer of at least 60 seconds");
  }

  const keys = ["billing:stripe:consumer-processed:" + effects.eventId];
  const args = [
    effects.eventId,
    String(effects.eventCreated ?? 0),
    String(processedEventTtlSeconds),
  ];

  for (const record of effects.records) {
    if (!record || typeof record.key !== "string" || !record.key.startsWith("billing:stripe:")) {
      throw new TypeError("Billing effect record has an invalid key");
    }
    if (!record.state || record.state.eventId !== effects.eventId) {
      throw new TypeError("Billing effect record does not match its event ID");
    }
    keys.push(record.key);
    args.push(
      String(record.state.eventCreated ?? effects.eventCreated ?? 0),
      String(record.rank ?? 0),
      effects.eventId,
      JSON.stringify(record.state),
    );
  }

  const result = await redisClient.eval(APPLY_BILLING_EFFECTS_SCRIPT, keys.length, ...keys, ...args);
  return Number(result) === 1;
}

export const STRIPE_BILLING_EVENT_TYPES = Object.freeze([
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.dispute.created",
]);
