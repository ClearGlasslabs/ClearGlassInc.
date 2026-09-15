# ClearGlass ATLAS

**ClearGlass ATLAS — a rules-based market research, risk analytics, and portfolio simulation platform.**

## Purpose

ATLAS is an explainable research and portfolio-intelligence layer for ClearGlass Inc. It is designed to collect **licensed or explicitly authorized** market, macroeconomic, company, and portfolio data; transform that data into reproducible analytics; and produce research, risk, scenario, and paper-trading outputs with provenance.

ATLAS does **not** represent a financial institution, replicate any institution's proprietary strategy, or provide guaranteed investment outcomes.

## Truth and claims policy

The system MUST NOT claim or imply:

- affiliation, partnership, endorsement, employment, or proprietary-data access involving Goldman Sachs or another financial institution;
- guaranteed returns, risk-free income, certain predictions, inside information, or proprietary institutional performance;
- fabricated backtests, Sharpe ratios, win rates, live-trading results, revenue, AUM, testimonials, customer outcomes, regulatory status, licenses, or compliance approvals.

Any unavailable evidence MUST be represented explicitly as one of:

- `UNKNOWN`
- `BLOCKED`
- `INCOMPLETE`
- `REQUIRES_HUMAN_REVIEW`

## Core capabilities

1. **Authorized data ingestion**
   - Accept only documented, licensed, public, or otherwise authorized data sources.
   - Record provider, dataset identifier, retrieval timestamp, license/authorization status, and source URI where permitted.
   - Fail closed when authorization or provenance is missing.

2. **Research analytics**
   - Descriptive statistics and return distributions.
   - Factor exposures and factor attribution.
   - Correlation, covariance, concentration, drawdown, volatility, and liquidity diagnostics.
   - Macro/company signal decomposition where the underlying data supports it.

3. **Scenario analysis**
   - Historical and hypothetical stress scenarios.
   - Explicit assumptions, parameter ranges, and sensitivity analysis.
   - No presentation of scenario outputs as forecasts or certainties.

4. **Portfolio simulation**
   - Paper-trading only unless a separately authorized execution system is introduced and approved.
   - Deterministic transaction-cost, slippage, position-limit, and risk-rule assumptions.
   - Full event ledger for simulated orders, fills, positions, cash, and P&L.

5. **Risk reporting**
   - Exposure, concentration, volatility, drawdown, liquidity, factor, scenario, and data-quality reporting.
   - Every material metric carries its calculation period, source data, assumptions, and status.

6. **Revenue operations**
   - Identify legitimate opportunities to commercialize approved research products, dashboards, subscriptions, reports, and analytics services.
   - Never fabricate customers, revenue, conversion rates, AUM, or commercial performance.
   - Commercial actions require explicit human approval where an external commitment, payment, contract, or regulated activity could result.

## Explainability contract

Every ATLAS output should be reproducible from:

`source data -> normalization -> feature/calculation definition -> parameters -> rule set -> result -> limitations`

Where practical, persist a content hash of the input snapshot and generated report so an analyst can determine whether an output changed because the source data, methodology, or parameters changed.

## Risk and governance boundaries

ATLAS is a **research and simulation platform**, not an autonomous investment adviser or trading venue. Any customer-facing financial research, recommendation, solicitation, execution, or other regulated activity must be reviewed for the applicable Canadian and other jurisdictional requirements before release.

The default operational mode is:

`RESEARCH -> SIMULATE -> VALIDATE -> HUMAN REVIEW -> PUBLISH`

not:

`PREDICT -> EXECUTE`

## Data quality states

| State | Meaning | Permitted action |
|---|---|---|
| `VERIFIED` | Required provenance and validation checks passed | Use in analytics |
| `UNKNOWN` | Required fact or metadata is unavailable | Do not infer it |
| `BLOCKED` | Authorization, integrity, or validation gate failed | Stop dependent processing |
| `INCOMPLETE` | Some required inputs are missing | Produce only explicitly partial outputs |
| `REQUIRES_HUMAN_REVIEW` | Automated checks cannot establish an acceptable conclusion | Route to analyst |

## Initial architecture boundary

ATLAS should remain modular:

- `ingestion/` — source adapters and authorization metadata
- `normalization/` — canonical market and portfolio schemas
- `analytics/` — deterministic research calculations
- `scenarios/` — stress and sensitivity models
- `simulation/` — paper-trading state machine and event ledger
- `risk/` — risk metrics and limits
- `provenance/` — source lineage, hashes, assumptions, and audit records
- `reports/` — machine-readable and human-readable outputs
- `governance/` — policy gates and human-review requirements

No live broker/exchange execution is part of the initial ATLAS scope.

## Implementation gates

Before a source is enabled:

1. Confirm source identity.
2. Confirm license/authorization and permitted use.
3. Confirm schema and timestamp semantics.
4. Validate integrity and completeness.
5. Record provenance metadata.
6. Add deterministic tests.
7. Run a non-production paper simulation.
8. Require human approval before customer-facing publication.

## Evidence standard

ATLAS must distinguish **observed data**, **derived analytics**, **model assumptions**, **scenario outputs**, and **analyst interpretations**. It must never collapse those categories into a claim of certainty.

## Commercial positioning

Approved positioning:

> ClearGlass ATLAS — a rules-based market research, risk analytics, and portfolio simulation platform.

The product may be packaged as research reports, risk dashboards, portfolio simulation workspaces, or subscription analytics where legally and commercially appropriate. Pricing, customer counts, revenue, performance, and outcomes must always be sourced from actual records.
