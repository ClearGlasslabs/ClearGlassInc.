/**
 * Membership plan registry and environment validation.
 * Amounts are never defined here: they come from the configured Stripe Price
 * objects, and an unconfigured offer is reported as unconfigured.
 */
export const PLANS = Object.freeze([
  {
    key: "signal",
    name: "Signal",
    tier: 1,
    summary: "Premium intelligence briefings, resilience updates, selected research and the subscriber library.",
    features: ["Premium intelligence briefings", "Resilience updates", "Selected research", "Subscriber library"],
    areas: ["briefings", "resilience_updates", "research", "library"],
  },
  {
    key: "assurance",
    name: "Assurance",
    tier: 2,
    summary: "Everything in Signal plus governance and resilience materials, priority advisory resources and quarterly risk and dependency updates.",
    features: ["Everything in Signal", "Governance and resilience materials", "Priority advisory resources", "Quarterly risk and dependency updates"],
    areas: ["governance_materials", "advisory_resources", "quarterly_updates"],
  },
  {
    key: "northstar",
    name: "Northstar",
    tier: 3,
    summary: "Everything in Assurance plus a dependency and evidence workspace, organizational reports and onboarding and support.",
    features: ["Everything in Assurance", "Dependency and evidence workspace", "Organizational reports", "Onboarding and support"],
    areas: ["evidence_workspace", "organizational_reports", "onboarding_support"],
  },
]);

/** Registry IDs map to server-side env var names. Clients only ever send plan + interval. */
export const OFFERS = Object.freeze([
  { id: "signal_monthly", plan: "signal", interval: "monthly", stripeInterval: "month", env: "STRIPE_PRICE_SIGNAL_MONTHLY" },
  { id: "signal_annual", plan: "signal", interval: "annual", stripeInterval: "year", env: "STRIPE_PRICE_SIGNAL_ANNUAL" },
  { id: "assurance_monthly", plan: "assurance", interval: "monthly", stripeInterval: "month", env: "STRIPE_PRICE_ASSURANCE_MONTHLY" },
  { id: "assurance_annual", plan: "assurance", interval: "annual", stripeInterval: "year", env: "STRIPE_PRICE_ASSURANCE_ANNUAL" },
  { id: "northstar_enterprise", plan: "northstar", interval: "enterprise", stripeInterval: null, env: "STRIPE_PRICE_NORTHSTAR_ENTERPRISE" },
]);

export const planByKey = (key) => PLANS.find((plan) => plan.key === key) ?? null;
export const offerFor = (plan, interval) => OFFERS.find((o) => o.plan === plan && o.interval === interval) ?? null;

const PRICE_ID = /^price_[A-Za-z0-9]{6,200}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function stripeKeyMode(key) {
  if (/^(?:sk|rk)_test_/.test(key ?? "")) return "test";
  if (/^(?:sk|rk)_live_/.test(key ?? "")) return "live";
  return null;
}

function originOf(name, value, production, errors) {
  if (!value) { errors.push(`${name} is required`); return null; }
  let url;
  try { url = new URL(value); } catch { errors.push(`${name} must be an absolute URL`); return null; }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(local && !production && url.protocol === "http:")) {
    errors.push(`${name} must use HTTPS${production ? "" : " (http is allowed only for localhost)"}`);
    return null;
  }
  return url.origin;
}

/**
 * Validates the environment. Never throws and never returns secret values;
 * `errors` contains only variable names and generic reasons.
 */
export function loadSubscriptionConfig(env = process.env) {
  const errors = [];
  const production = env.NODE_ENV === "production";
  const mode = stripeKeyMode(env.STRIPE_SECRET_KEY);
  if (!mode) errors.push("STRIPE_SECRET_KEY must be a test or live secret/restricted key");
  if (!env.DATABASE_URL) errors.push("DATABASE_URL is required");
  const authSecret = env.AUTH_SECRET ?? "";
  if (authSecret.length < 32) errors.push("AUTH_SECRET must be at least 32 characters");
  const appOrigin = originOf("APP_BASE_URL", env.APP_BASE_URL, production, errors);
  const siteOrigin = originOf("SITE_BASE_URL", env.SITE_BASE_URL, production, errors);

  const offers = new Map();
  const seen = new Set();
  for (const offer of OFFERS) {
    const raw = (env[offer.env] ?? "").trim();
    if (!raw) { offers.set(offer.id, { ...offer, priceId: null }); continue; }
    if (!PRICE_ID.test(raw)) { errors.push(`${offer.env} is not a valid Stripe Price ID`); offers.set(offer.id, { ...offer, priceId: null }); continue; }
    if (seen.has(raw)) errors.push(`${offer.env} duplicates another plan's Price ID`);
    seen.add(raw);
    offers.set(offer.id, { ...offer, priceId: raw });
  }
  if (![...offers.values()].some((o) => o.priceId && o.plan !== "northstar")) {
    errors.push("At least one Signal or Assurance Price ID must be configured");
  }

  const trialAccess = (env.SUBSCRIPTION_TRIAL_ACCESS ?? "deny").toLowerCase();
  if (!["deny", "allow"].includes(trialAccess)) errors.push("SUBSCRIPTION_TRIAL_ACCESS must be deny or allow");
  const grace = Number(env.SUBSCRIPTION_ACCESS_GRACE_SECONDS ?? 0);
  if (!Number.isInteger(grace) || grace < 0 || grace > 86_400) errors.push("SUBSCRIPTION_ACCESS_GRACE_SECONDS must be an integer from 0 to 86400");

  const contactUrl = env.NORTHSTAR_CONTACT_URL || "mailto:sales@clearglassinc.com?subject=Northstar%20access%20request";
  if (!/^(mailto:|https:\/\/)/.test(contactUrl)) errors.push("NORTHSTAR_CONTACT_URL must be a mailto: or https:// URL");

  const smtpPort = Number(env.SMTP_PORT ?? 587);
  const smtp = env.SMTP_HOST && env.MAIL_FROM
    ? {
        host: env.SMTP_HOST,
        port: Number.isInteger(smtpPort) ? smtpPort : 587,
        secure: env.SMTP_SECURE === "true",
        user: env.SMTP_USER || undefined,
        password: env.SMTP_PASSWORD || undefined,
        from: env.MAIL_FROM,
      }
    : null;

  return {
    ok: errors.length === 0,
    errors,
    production,
    mode,
    livemode: mode === "live",
    environment: mode,
    authSecret,
    appOrigin,
    siteOrigin,
    offers,
    priceMap: new Map([...offers.values()].filter((o) => o.priceId).map((o) => [o.priceId, o])),
    trialAccess: trialAccess === "allow",
    graceSeconds: Number.isInteger(grace) ? grace : 0,
    automaticTax: env.STRIPE_AUTOMATIC_TAX === "true",
    portalConfigurationId: env.STRIPE_PORTAL_CONFIGURATION_ID || undefined,
    contactUrl,
    smtp,
    secureCookies: production || (appOrigin ?? "").startsWith("https:"),
  };
}
