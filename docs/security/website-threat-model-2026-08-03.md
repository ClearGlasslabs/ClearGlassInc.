# ClearGlassInc Artemis Website Threat Model

**Assessment date:** 2026-08-03. **Scope:** repository source and Render manifest only. This is a prioritized engineering assessment, not legal advice, certification, penetration test, or assertion about controls outside this repository.

## System and trust boundaries

The public static NEXUS page executes in an untrusted browser and requests public feeds directly. The Node API crosses four boundaries: Internet→Express, Express→Stripe/Gumroad, Express→Redis, and Express→the event-bus shim. Render, GitHub Pages/custom-domain hosting, DNS/CDN, payment providers, and feed operators are separate processors/control planes. Premium-content storage, identity provider, WAF/CDN, backups, and Palantir tenant configuration are not present in this repository and therefore were not verified.

## Ranked risks (documented before implementation)

| Rank | Risk | Likelihood / impact | Repository response |
|---:|---|---|---|
| 1 Critical | Event ingest and approval endpoints allowed unauthenticated writes; caller supplied the audit actor. | High / Critical integrity and privilege impact | Bearer-token role gates, server-derived actor, identifier validation, body limits, throttling. Replace bootstrap tokens with OIDC/mTLS before mission use. |
| 2 Critical | Gumroad payloads were accepted when any signature header existed. | High / High forged billing events | HMAC verification and mandatory secret; provider-specific algorithm/header must be validated against the active Gumroad contract before enabling. |
| 3 High | Event bus logged entire events, potentially exposing tokens, personal or operational data. | High / High confidentiality | Structured metadata-only logging. Durable, encrypted, access-controlled audit/event storage remains deployment work. |
| 4 High | Inline JavaScript, inline handlers, and no CSP/security headers increased XSS/clickjacking exposure. | Medium / High | Externalized executable JS, removed handlers, added restrictive CSP/meta and deployable header file. Inline styles remain allowed for current visual fidelity. |
| 5 High | Third-party feed strings and camera URLs entered HTML templates without contextual encoding. | Medium / High XSS/content injection | Encode camera labels and constrain image URLs to HTTPS. Other numeric/feed rendering paths require continuing migration from `innerHTML` to DOM APIs. |
| 6 High | No CI dependency/secret/static security scanning or artifact manifest. | Medium / High supply-chain impact | Security workflow, release SHA-256 manifest, production checks. Action/service governance remains an owner duty. |
| 7 Medium | No privacy/terms/takedown/retention notice or security contact. | High / Medium legal and trust impact | Placeholder legal page, notices, security.txt, retention schedule. Qualified counsel must localize and approve before representing it as effective. |
| 8 Medium | Public assets can be copied/screenshotted and feeds can be bulk fetched. | High / Medium IP/availability | Ownership notice, page watermark, terms, throttling on API. Public content cannot be made extraction-proof; restricted assets need authenticated delivery not present here. |
| 9 Medium | In-memory rate limits are per instance and reset on deploy. | Medium / Medium availability/abuse | Immediate progressive throttle. Move counters and anomaly rules to Redis/CDN/WAF for distributed enforcement. |
| 10 Medium | No MFA-backed administrator identity, session rotation, recovery workflow, upload security, signed download service, or immutable audit ledger is implemented by this website. | Variable / High | Explicit deployment blockers below; do not expose those features until centralized identity/policy controls exist. |

## Abuse progression and alerting

Log rejected authentication, signature failures, rate-limit triggers, bulk sequential identifiers, token reuse from implausible locations, and authorization denials without recording secrets, raw bodies, email addresses, or query strings. Recommended progression is **observe → throttle → standards-based challenge at CDN → temporary scoped block → human alert**. Never retaliate, interfere with devices, or unlawfully track users. Alert immediately on approval-route brute force, cross-role denial bursts, verified webhook replay, or suspected disclosure; alert at 20 authentication failures per source/5 minutes and tune against production baselines.

## Security and privacy requirements requiring counsel

Potential regimes depend on entity, users, targeting, data and contracts: Canadian PIPEDA and provincial private-sector/health laws; Québec Law 25; EU/UK GDPR and ePrivacy/PECR; California CCPA/CPRA and other US state privacy laws; consumer-protection and auto-renewal rules; PCI responsibilities allocated with Stripe; CASL/CAN-SPAM for messaging; copyright/takedown regimes; accessibility requirements including AODA/ACA, ADA/Section 508 where applicable, and EN 301 549; breach-notification, records, sanctions/export-control, employment, biometrics, and children's-privacy rules. Counsel must determine scope, lawful bases, notices, data-processing agreements, transfer mechanisms, retention, age gates, cookie consent, statutory agent registration, governing law, and accessibility target (WCAG 2.2 AA is the recommended engineering baseline, not a current conformance claim).

## Acceptance criteria before restricted/mission deployment

Federated phishing-resistant MFA; short-lived audience-bound tokens; entity/row/column/compartment policy enforcement; two-person approval for consequential actions; distributed rate limiting; WAF/bot rules tested with accessibility tools and verified search crawlers; encrypted backups and restore exercises; centralized tamper-evident audit records; secret manager and rotation drill; signed, expiring object-store URLs with `private, no-store`; malware/CDR upload pipeline; webhook timestamp/replay controls; SAST/DAST/dependency/container/IaC scanning; documented DPO/legal/security ownership; and Palantir Gotham/Foundry/AIP/Apollo controls verified in the actual tenant.
