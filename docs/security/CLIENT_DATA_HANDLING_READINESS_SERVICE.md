# Client Data Handling — Readiness Review

**Status:** Internal draft. Verify against actual tools, contracts, insurance and applicable obligations before customer use.

## Before collection
- Obtain written scope and authorization for each system/method.
- Define the minimum data needed, approved storage, named access roles, retention/deletion, AI tools/subprocessors and incident contact.
- Default to read-only, least-privilege, time-limited access.
- Never request or store passwords, MFA codes, private keys, recovery codes, payment-card data or unrelated personal information.

## During work
- Collect only evidence relevant to the agreed scope.
- Record evidence ID, source/system, collection time, method, scope reference, redactions and reviewer.
- Prefer a small excerpt or configuration metadata over copying a full dataset.
- Keep customer artifacts out of public repositories, general chat, analytics and unapproved AI prompts.
- Stop if scope is exceeded, unexpected sensitive data appears, or authorization is unclear.

## AI processing
Default to synthetic or redacted material. Before real customer data is processed by an AI service, confirm written authorization, vendor terms, retention/training settings, transfer/location requirements and contractual/privacy basis. AI output remains a draft until a human checks factual statements and recommendations.

## Storage and closeout
Use approved encrypted storage and MFA, restrict access to authorized people, share reports through the agreed channel, revoke temporary access when appropriate, and delete working copies according to the agreed retention schedule. Do not promise third-party backup deletion unless verified. Record deletion evidence and exceptions.

## Incident handling
Stop the affected activity, preserve necessary evidence safely, notify the designated owner, assess with qualified support, follow applicable contractual/legal/insurer obligations, document decisions, and resume only after authorization and mitigation are recorded.

## Readiness gate
This procedure is not ready for customer use until actual storage tools, access controls, AI providers, retention periods, incident contacts and contractual terms are identified and tested.