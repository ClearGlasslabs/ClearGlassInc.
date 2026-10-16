import os from "node:os";
import { pathToFileURL } from "node:url";
import Redis from "ioredis";
import Stripe from "stripe";
import {
  STRIPE_BILLING_EVENT_TYPES,
  applyStripeBillingEffects,
  buildStripeBillingEffects,
} from "./stripe-consumer.js";

const STREAM = "billing.subscription.events";
const GROUP = process.env.STRIPE_CONSUMER_GROUP || "billing-consumer-v1";
const CONSUMER = process.env.STRIPE_CONSUMER_NAME || (os.hostname() + "-" + process.pid);
const DEAD_LETTER_STREAM = "billing.subscription.events.dead";
const MAX_ATTEMPTS = 5;
const PENDING_IDLE_MS = 60_000;
const ATTEMPT_TTL_SECONDS = 604_800;
const PROCESSED_EVENT_TTL_SECONDS = Number(process.env.STRIPE_PROCESSED_EVENT_TTL_SECONDS ?? 31_536_000);

const MOVE_TO_DEAD_LETTER_SCRIPT = [
  "redis.call('XADD', KEYS[2], '*',",
  "  'source_stream_id', ARGV[2],",
  "  'event_id', ARGV[3],",
  "  'event_type', ARGV[4],",
  "  'attempts', ARGV[5],",
  "  'error_type', ARGV[6],",
  "  'failed_at', ARGV[7])",
  "redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])",
  "redis.call('DEL', KEYS[3])",
  "return 1",
].join("\n");

function fieldsToObject(fields) {
  const result = {};
  for (let i = 0; i < fields.length; i += 2) {
    result[fields[i]] = fields[i + 1];
  }
  return result;
}

function eventClass(eventType) {
  return STRIPE_BILLING_EVENT_TYPES.includes(eventType) ? "supported" : "ignored";
}

async function ensureGroup(redis) {
  try {
    // Start at 0-0 so durable events already in the stream are not silently skipped.
    await redis.xgroup("CREATE", STREAM, GROUP, "0-0", "MKSTREAM");
  } catch (error) {
    if (!String(error?.message ?? error).includes("BUSYGROUP")) throw error;
  }
}

async function deadLetter(redis, streamId, fields, attempts, error) {
  const values = fieldsToObject(fields);
  await redis.eval(
    MOVE_TO_DEAD_LETTER_SCRIPT,
    3,
    STREAM,
    DEAD_LETTER_STREAM,
    "stripe:consumer:attempts:" + streamId,
    GROUP,
    streamId,
    values.event_id ?? "unknown",
    values.event_type ?? "unknown",
    String(attempts),
    error instanceof Error ? error.name : "Error",
    new Date().toISOString(),
  );
  console.error("Stripe event moved to dead-letter stream", {
    streamId,
    eventId: values.event_id ?? "unknown",
    eventType: values.event_type ?? "unknown",
    attempts,
    errorType: error instanceof Error ? error.name : "Error",
  });
}

export async function processEntry(redis, stripe, streamId, fields) {
  const values = fieldsToObject(fields);
  const attemptsKey = "stripe:consumer:attempts:" + streamId;

  try {
    if (values.provider !== "stripe") throw new TypeError("Unexpected event provider");
    if (typeof values.payload !== "string") throw new TypeError("Missing queued event payload");
    const event = JSON.parse(values.payload);
    if (!event || event.id !== values.event_id || event.type !== values.event_type) {
      throw new TypeError("Queued Stripe event metadata mismatch");
    }

    const apiKey = process.env.STRIPE_SECRET_KEY ?? "";
    const keyModeKnown = /^(?:sk|rk)_(?:test|live)_/.test(apiKey);
    if (!keyModeKnown) throw new Error("Stripe API key mode is not configured");
    const keyIsLive = /^(?:sk|rk)_live_/.test(apiKey);
    if (Boolean(event.livemode) !== keyIsLive) {
      throw new Error("Stripe event mode does not match consumer API key mode");
    }

    // Unknown event types are marked processed and acknowledged, but never trigger
    // business writes. The Stripe endpoint should be configured with the documented set.
    const effects = eventClass(event.type) === "supported"
      ? await buildStripeBillingEffects(event, stripe)
      : { eventId: event.id, eventType: event.type, eventCreated: event.created ?? 0, records: [] };
    await applyStripeBillingEffects(redis, effects, {
      processedEventTtlSeconds: PROCESSED_EVENT_TTL_SECONDS,
    });

    await redis.xack(STREAM, GROUP, streamId);
    await redis.del(attemptsKey);
  } catch (error) {
    const attempts = await redis.incr(attemptsKey);
    await redis.expire(attemptsKey, ATTEMPT_TTL_SECONDS);
    console.error("Stripe event processing failed", {
      streamId,
      eventId: values.event_id ?? "unknown",
      eventType: values.event_type ?? "unknown",
      attempt: attempts,
      errorType: error instanceof Error ? error.name : "Error",
    });

    if (attempts >= MAX_ATTEMPTS) {
      // Dead-letter insertion and XACK are atomic; if Redis fails, this function
      // throws and the original item remains pending for a later retry.
      await deadLetter(redis, streamId, fields, attempts, error);
    }
  }
}

function extractEntries(response) {
  if (!Array.isArray(response)) return [];
  const result = [];
  for (const streamResult of response) {
    if (!Array.isArray(streamResult) || !Array.isArray(streamResult[1])) continue;
    for (const entry of streamResult[1]) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && Array.isArray(entry[1])) {
        result.push(entry);
      }
    }
  }
  return result;
}

async function main() {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!/^(?:sk|rk)_(?:test|live)_/.test(apiKey ?? "")) {
    throw new Error("STRIPE_SECRET_KEY must be configured for test or live mode");
  }
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL must be configured for the Stripe worker");

  const stripe = new Stripe(apiKey);
  const redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  redis.on("error", (error) => {
    console.error("Stripe worker Redis connection error", {
      errorType: error instanceof Error ? error.name : "Error",
    });
  });

  await ensureGroup(redis);
  console.log("Stripe billing consumer ready", {
    group: GROUP,
    consumer: CONSUMER,
    stream: STREAM,
    deadLetterStream: DEAD_LETTER_STREAM,
  });

  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  try {
    while (!stopping) {
      // Reclaim abandoned work after a worker crash/restart before reading new entries.
      const claimed = await redis.xautoclaim(
        STREAM, GROUP, CONSUMER, PENDING_IDLE_MS, "0-0", "COUNT", 10,
      );
      const claimedEntries = Array.isArray(claimed?.[1]) ? claimed[1] : [];
      for (const [id, fields] of claimedEntries) {
        if (stopping) break;
        await processEntry(redis, stripe, id, fields);
      }
      if (stopping) break;

      const response = await redis.xreadgroup(
        "GROUP", GROUP, CONSUMER,
        "COUNT", "10",
        "BLOCK", "5000",
        "STREAMS", STREAM, ">",
      );
      for (const [id, fields] of extractEntries(response)) {
        if (stopping) break;
        await processEntry(redis, stripe, id, fields);
      }
    }
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    try { await redis.quit(); } catch { redis.disconnect(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Stripe billing consumer stopped", {
      errorType: error instanceof Error ? error.name : "Error",
    });
    process.exitCode = 1;
  });
}
