-- Subscriber accounts, sessions, Stripe customer mapping, subscriptions,
-- entitlements, webhook idempotency and audit. PostgreSQL 13+.
-- Stores minimal PII (email only). No card data is ever stored.

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  disabled_at timestamptz,
  constraint users_email_normalized check (email = lower(btrim(email)))
);
create unique index users_email_key on users (email);

-- Single-use, short-lived, keyed-hash login challenges. The raw token is only
-- ever present in the emailed link.
create table auth_challenges (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email text not null,
  intent_plan text,
  intent_interval text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index auth_challenges_expires_idx on auth_challenges (expires_at);

-- Opaque sessions: only a keyed hash of the cookie value is stored.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_user_idx on sessions (user_id);

-- Trusted Stripe customer mapping. Never derived from client-editable values.
create table stripe_customers (
  id bigserial primary key,
  user_id uuid not null references users (id) on delete cascade,
  stripe_customer_id text not null,
  livemode boolean not null,
  created_at timestamptz not null default now(),
  unique (stripe_customer_id),
  unique (user_id, livemode)
);

create table subscriptions (
  stripe_subscription_id text primary key,
  user_id uuid not null references users (id) on delete cascade,
  stripe_customer_id text not null,
  plan_key text,
  billing_interval text,
  price_id text,
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancel_at timestamptz,
  trial_end timestamptz,
  latest_invoice_status text,
  latest_invoice_reason text,
  livemode boolean not null,
  deleted_at timestamptz,
  last_event_id text not null,
  last_verified_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index subscriptions_user_idx on subscriptions (user_id);

-- Materialised summary of the latest computed entitlement. Request handling
-- recomputes from subscriptions + the clock and never trusts this row alone.
create table entitlements (
  user_id uuid primary key references users (id) on delete cascade,
  plan_key text,
  active_until timestamptz,
  source_event_id text,
  updated_at timestamptz not null default now()
);

-- Webhook idempotency: an event id is recorded in the same transaction as its effects.
create table stripe_events (
  event_id text primary key,
  event_type text not null,
  livemode boolean not null,
  stripe_created_at timestamptz,
  processed_at timestamptz not null default now()
);

create table billing_audit (
  id bigserial primary key,
  event_id text,
  user_id uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index billing_audit_user_idx on billing_audit (user_id, created_at);

-- Durable rate limiting for auth and checkout abuse controls.
create table rate_limit_events (
  id bigserial primary key,
  scope text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_events_lookup_idx on rate_limit_events (scope, key_hash, created_at);
