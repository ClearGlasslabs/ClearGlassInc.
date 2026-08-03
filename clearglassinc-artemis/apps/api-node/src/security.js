import crypto from "node:crypto";

const buckets = new Map();
export function securityHeaders(req, res, next) {
  const requestId = req.headers["x-request-id"]?.slice(0, 64) || crypto.randomUUID();
  req.requestId = requestId;
  res.set({
    "X-Request-ID": requestId,
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-site",
    "Cache-Control": "no-store",
  });
  next();
}

export function rateLimit({ limit = 60, windowMs = 60_000 } = {}) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const item = buckets.get(key);
    const bucket = !item || item.reset <= now ? { count: 0, reset: now + windowMs } : item;
    bucket.count += 1;
    buckets.set(key, bucket);
    res.set("RateLimit-Policy", `${limit};w=${Math.ceil(windowMs / 1000)}`);
    res.set("RateLimit-Remaining", String(Math.max(0, limit - bucket.count)));
    if (bucket.count > limit) return res.status(429).json({ error: "rate_limited", requestId: req.requestId });
    next();
  };
}

function equalSecret(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function requireRole(...allowed) {
  return (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9._~-]{20,512})$/)?.[1];
    const configured = [
      ["admin", process.env.ARTEMIS_ADMIN_API_TOKEN],
      ["operator", process.env.ARTEMIS_OPERATOR_API_TOKEN],
      ["ingest", process.env.ARTEMIS_INGEST_API_TOKEN],
    ];
    const role = configured.find(([, secret]) => equalSecret(token, secret))?.[0];
    if (!role) return res.status(401).json({ error: "unauthorized", requestId: req.requestId });
    if (!allowed.includes(role) && role !== "admin") return res.status(403).json({ error: "forbidden", requestId: req.requestId });
    req.auth = { role, actor: `token:${role}` };
    next();
  };
}

export function requireTrustedOrigin(req, res, next) {
  const allowed = new Set((process.env.ALLOWED_ORIGINS ?? "").split(",").map(v => v.trim()).filter(Boolean));
  const origin = req.headers.origin;
  if (origin && !allowed.has(origin)) return res.status(403).json({ error: "untrusted_origin", requestId: req.requestId });
  next();
}

export function validIdentifier(value) { return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value); }
export function validEmail(value) { return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
export function verifyHmac(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || !secret || typeof signature !== "string") return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return equalSecret(signature.replace(/^sha256=/, ""), expected);
}
