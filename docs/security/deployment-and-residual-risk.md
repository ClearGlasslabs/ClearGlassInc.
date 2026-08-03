# Security Deployment, Verification, Rollback, and Residual Risk

## Deployment

1. Have qualified counsel replace every bracketed placeholder in `legal.html`, approve jurisdictional language, and confirm monitored contacts.
2. Generate independent secrets (`openssl rand -base64 48`) in Render/secret manager for `ARTEMIS_ADMIN_API_TOKEN`, `ARTEMIS_OPERATOR_API_TOKEN`, `ARTEMIS_INGEST_API_TOKEN`, and provider-approved `GUMROAD_WEBHOOK_SECRET`. Set `ALLOWED_ORIGINS`. Never put values in Git or CI output.
3. Replace bootstrap bearer tokens with OIDC access tokens (short expiry, issuer/audience validation, MFA claims) or mTLS before mission use. Rotate bootstrap tokens after deployment validation.
4. Configure equivalent static headers at the actual CDN/host; `_headers` is not interpreted by GitHub Pages. Test CSP in report-only on a staging hostname, then enforce. Do not request HSTS preload until every subdomain is HTTPS-ready.
5. Put the API behind a managed CDN/WAF. Implement shared Redis quotas and progressive bot responses. Explicitly allow verified search crawlers and accessibility tooling rather than trusting user-agent strings.
6. Configure alert routing, immutable log sink, time synchronization, encrypted backup schedule, retention jobs, legal holds, key revocation, and quarterly restore tests. Record owners and evidence.
7. For protected assets, authorize every request server-side, issue audience/user-bound signed URLs for at most five minutes, return `Cache-Control: private, no-store`, and dynamically stamp account pseudonym + UTC timestamp into rendered/exported content. Keep originals in a private bucket. No such premium asset service exists in this repository.
8. Deploy exact commit, verify checks below, then create and preserve a signed release/tag plus `releases/SHA256SUMS`. Apollo canary/rollback controls require Palantir and hosting access outside this repository.

## Verification

```bash
curl -fsSI https://www.clearglassinc.com/ | sed -n '1,30p'
curl -fsS https://www.clearglassinc.com/.well-known/security.txt
curl -fsSI https://API_HOST/healthz
curl -i -X POST https://API_HOST/v1/events/ingest -H 'content-type: application/json' --data '{"id":"probe"}' # expect 401
curl -i -X POST https://API_HOST/v1/events/ingest -H "authorization: Bearer $ARTEMIS_INGEST_API_TOKEN" -H 'content-type: application/json' --data '{"id":"authorized_probe"}' # expect 202
curl -i -X POST https://API_HOST/v1/actions/test/approve -H "authorization: Bearer $ARTEMIS_INGEST_API_TOKEN" -H 'content-type: application/json' --data '{}' # expect 403
sha256sum -c releases/SHA256SUMS
```

Use browser developer tools to confirm no CSP violations except deliberately staged reports, no mixed content, keyboard accessibility, meaningful alt text, and no secrets/PII in console/network/error telemetry. Run authenticated DAST only against an authorized staging environment.

## Rollback

1. Stop rollout or use Render/Apollo rollback to the last known-good immutable image/commit. Security regressions should fail closed; do not restore unauthenticated write routes.
2. If credentials or webhook integrity may be affected, revoke and rotate tokens/provider secrets first, invalidate sessions/signed URLs, then rollback code.
3. Preserve logs, image digest, commit, timestamps, and volatile evidence; do not rewrite or delete evidence. Start the incident runbook and legal notification analysis.
4. Re-run smoke/authorization/header/hash checks on the restored version. Document decision, approvers, blast radius, and follow-up.

## Residual limitations

The public page remains inherently copyable and screenshot-able. Its watermark is an attribution deterrent, not DRM or proof of the viewer. Inline style attributes require `style-src 'unsafe-inline'`; migrate them before a stricter style policy. Browser-to-third-party feeds expose visitor IP addresses to those providers and availability/terms can change. A public CORS proxy adds a trust and availability dependency and should be replaced by an allowlisted, caching server-side fetcher. Static-host headers depend on host configuration. API bootstrap tokens do not provide MFA, user identity, session rotation, revocation lists, or coalition compartments. In-memory throttles are not distributed. No real durable event bus, database query layer, upload handler, encrypted backup, signed-download service, consent platform, SIEM, WAF/CDN, DAST target, Palantir environment, or DNS configuration was available to verify. Legal templates are not effective legal advice until approved and completed.
