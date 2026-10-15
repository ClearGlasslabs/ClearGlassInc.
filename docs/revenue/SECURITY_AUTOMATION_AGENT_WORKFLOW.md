# Security & Automation Service — AI Workflow

**Mode:** Human-directed assistance, not autonomous selling or remediation.

## Flow
1. Founder supplies an inbound request or prospect record.
2. Research assistant drafts a source-linked brief and labels unknowns.
3. Founder qualifies the account and chooses whether to proceed.
4. Assistant drafts discovery questions and, from founder-provided notes, a summary.
5. Proposal assistant drafts scope, exclusions, assumptions and price fields.
6. Founder explicitly approves any external message or proposal.
7. Payment status is verified against the provider's source-of-record.
8. Delivery begins only after agreement, written authorization and prerequisites.
9. Assistant organizes authorized evidence and drafts report wording with limitations.
10. Human reviewer verifies each finding and approves delivery.
11. Reconcile payment, scope, delivery, refunds and next step.

## Agent boundaries
- Lead research may summarize lawful public business information with source and date; it may not contact prospects or invent pain points.
- Qualification may flag fit and unknowns; assumptions stay labeled as hypotheses.
- Proposal drafting may prepare text; it may not commit pricing, sign or send.
- Delivery drafting may organize authorized evidence; it may not access customer systems or mark findings verified without review.
- KPI assistant may reconcile records; invoice creation or checkout redirects are not proof of collected cash.

## Mandatory gates
Human approval is required before external communication, publication, payment requests/refunds, contract commitments, customer-system access, production changes or deployment. This document does not grant access to any external system.

## Controls
Use least privilege, separate customer records, keep secrets out of prompts/logs/source control, prefer read-only evidence, preserve approval records, and stop on missing authorization or inconsistent evidence. Any future workflow that creates records or sends events must be idempotent to prevent duplicates. No autonomous outbound campaign or remediation is in scope.