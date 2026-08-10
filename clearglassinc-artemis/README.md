# ClearGlassInc Artemis

Automated, self-improving intelligence + monetization platform with strict human-governed safety.

> Status: starter scaffold. This monorepo contains service skeletons, SQL migrations,
> ontology definitions, eval/CI stubs, and architecture docs. It is not production-ready;
> integrations (Palantir Foundry/Gotham/AIP/Apollo, Stripe, Gumroad) are stubbed.

## Layout

```
apps/
  web-ui/        Next.js operator UI (stub)
  admin-rails/   Rails admin / billing / refunds (stub)
  api-node/      Node API gateway + webhooks
  ai-python/     Python AI orchestrator + agent runtime + evals
services/
  event-router/  event mesh fan-out (stub)
  policy-engine/ OPA/Cedar policy packs
  audit-ledger/  immutable append-only audit (stub)
  notifier/      operator notifications (stub)
data/
  sql/           Postgres migrations
  ontology/      Foundry ontology object/edge definitions
  evals/         eval suites
infra/
  docker/        Dockerfiles + compose
  github-actions/ CI workflows
workflows/       Temporal-style workflow definitions
docs/            architecture + runbooks
```

## Safety model

No AI proposal (prompt / workflow / routing / model change) reaches production without:
1. policy pass, 2. confidence threshold pass, 3. human approval token,
4. immutable audit write, 5. execution with rollback handle.

See `docs/architecture/overview.md`.

For the production-grade Palantir architecture, ontology, agent design, governed
self-improvement lifecycle, code contracts, and end-to-end mission scenario, see
[`docs/architecture/production-blueprint.md`](docs/architecture/production-blueprint.md).
