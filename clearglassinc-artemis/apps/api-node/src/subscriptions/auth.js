import crypto from "node:crypto";

export const CHALLENGE_TTL_MINUTES = 15;
export const SESSION_ABSOLUTE_SECONDS = 14 * 86_400;
export const SESSION_IDLE_SECONDS = 3 * 86_400;
const TOUCH_AFTER_SECONDS = 300;

export const COOKIE_NAME = (ctx) => (ctx.secureCookies ? "__Host-cg_session" : "cg_session");

export const newToken = () => crypto.randomBytes(32).toString("base64url");

/** Keyed hash so a database leak alone cannot be replayed as a token. */
export function hashToken(secret, purpose, token) {
  return crypto.createHmac("sha256", secret).update(`${purpose}:${token}`).digest("hex");
}

export function csrfTokenFor(secret, sessionId) {
  return crypto.createHmac("sha256", secret).update(`csrf:${sessionId}`).digest("hex");
}

export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const normalizeEmail = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
}

export function sessionCookie(ctx, value, maxAgeSeconds) {
  return [
    `${COOKIE_NAME(ctx)}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`,
    ...(ctx.secureCookies ? ["Secure"] : []),
  ].join("; ");
}

/** Durable (Postgres-backed) rate limit. Returns true when the action is allowed. */
export async function consumeRateLimit(db, ctx, scope, key, limit, windowSeconds) {
  const keyHash = hashToken(ctx.authSecret, "rl", String(key));
  const { rows } = await db.query(
    `with ins as (insert into rate_limit_events (scope, key_hash) values ($1, $2) returning 1)
     select count(*)::int as n from rate_limit_events
     where scope = $1 and key_hash = $2 and created_at > now() - make_interval(secs => $3)`,
    [scope, keyHash, windowSeconds],
  );
  if (Math.random() < 0.01) {
    await db.query("delete from rate_limit_events where created_at < now() - interval '1 day'").catch(() => {});
    await db.query("delete from auth_challenges where expires_at < now() - interval '1 day'").catch(() => {});
    await db.query("delete from sessions where expires_at < now() - interval '1 day'").catch(() => {});
  }
  // The statement's snapshot excludes the row it inserted, so count + 1 includes this attempt.
  return rows[0].n + 1 <= limit;
}

export async function createChallenge(db, ctx, email, intent = {}) {
  const token = newToken();
  await db.query(
    `insert into auth_challenges (token_hash, email, intent_plan, intent_interval, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(mins => $5))`,
    [hashToken(ctx.authSecret, "challenge", token), email, intent.plan ?? null, intent.interval ?? null, CHALLENGE_TTL_MINUTES],
  );
  return token;
}

/** Atomically consumes a challenge (single use) and creates a fresh session. */
export async function redeemChallenge(db, ctx, token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  return db.tx(async (tx) => {
    const { rows } = await tx.query(
      `update auth_challenges set consumed_at = now()
       where token_hash = $1 and consumed_at is null and expires_at > now()
       returning email, intent_plan, intent_interval`,
      [hashToken(ctx.authSecret, "challenge", token)],
    );
    if (!rows.length) return null;
    const { email, intent_plan: plan, intent_interval: interval } = rows[0];
    const user = (await tx.query(
      `insert into users (email, last_login_at) values ($1, now())
       on conflict (email) do update set last_login_at = now() returning id, disabled_at`,
      [email],
    )).rows[0];
    if (user.disabled_at) return null;
    const sessionToken = newToken();
    await tx.query(
      `insert into sessions (user_id, token_hash, expires_at) values ($1, $2, now() + make_interval(secs => $3))`,
      [user.id, hashToken(ctx.authSecret, "session", sessionToken), SESSION_ABSOLUTE_SECONDS],
    );
    await tx.query("insert into billing_audit (user_id, action) values ($1, 'login')", [user.id]);
    return { sessionToken, plan, interval };
  });
}

export async function loadSession(db, ctx, token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  const { rows } = await db.query(
    `select s.id as session_id, s.last_seen_at, u.id as user_id, u.email
     from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()
       and s.last_seen_at > now() - make_interval(secs => $2) and u.disabled_at is null`,
    [hashToken(ctx.authSecret, "session", token), SESSION_IDLE_SECONDS],
  );
  if (!rows.length) return null;
  const row = rows[0];
  if (Date.now() - new Date(row.last_seen_at).getTime() > TOUCH_AFTER_SECONDS * 1000) {
    await db.query("update sessions set last_seen_at = now() where id = $1", [row.session_id]);
  }
  return { sessionId: row.session_id, userId: row.user_id, email: row.email };
}

export const revokeSession = (db, sessionId) =>
  db.query("update sessions set revoked_at = now() where id = $1 and revoked_at is null", [sessionId]);
