// Non-billing notifications are metadata-only until a production bus adapter is configured.
export async function publish(topic, message) {
  const safeMetadata = { id: message?.id ?? message?.event?.id ?? message?.action_id, type: message?.event?.type, decision: message?.decision };
  console.log(JSON.stringify({ event: "bus.publish", topic, metadata: safeMetadata }));
}

const STRIPE_EVENT_STREAM = "billing.subscription.events";
const STRIPE_IDEMPOTENCY_TTL_SECONDS = 604800;

// Redis executes this Lua script atomically: a duplicate event is detected and a
// stream entry is appended in one operation, eliminating the GET/SET race.
const ENQUEUE_STRIPE_EVENT_SCRIPT = `
local existing = redis.call("GET", KEYS[1])
if existing then return 0 end
local stream_id = redis.call(
  "XADD", KEYS[2], "*",
  "provider", "stripe",
  "event_id", ARGV[1],
  "event_type", ARGV[2],
  "livemode", ARGV[3],
  "payload", ARGV[4],
  "received_at", ARGV[5]
)
redis.call("SET", KEYS[1], stream_id, "EX", ARGV[6])
return 1
`;

/**
 * Persist a verified Stripe event in a Redis Stream exactly once per event ID
 * within the seven-day Stripe redelivery window. The event consumer must still
 * apply billing effects idempotently before granting access or fulfilling work.
 */
export async function enqueueStripeEventOnce(redisClient, event) {
  if (!redisClient || typeof redisClient.eval !== "function") {
    throw new TypeError("A Redis client with eval support is required");
  }
  if (!event || typeof event.id !== "string" || !event.id ||
      typeof event.type !== "string" || !event.type) {
    throw new TypeError("A verified Stripe event with id and type is required");
  }

  const normalizedEvent = {
    id: event.id,
    type: event.type,
    created: event.created,
    livemode: Boolean(event.livemode),
    data: event.data,
  };
  const result = await redisClient.eval(
    ENQUEUE_STRIPE_EVENT_SCRIPT,
    2,
    `idem:stripe:${event.id}`,
    STRIPE_EVENT_STREAM,
    event.id,
    event.type,
    String(Boolean(event.livemode)),
    JSON.stringify(normalizedEvent),
    new Date().toISOString(),
    String(STRIPE_IDEMPOTENCY_TTL_SECONDS),
  );
  return Number(result) === 1;
}
