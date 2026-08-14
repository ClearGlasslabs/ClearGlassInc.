# ClearGlass Graph Engineering

`orchestration/graph_engineering` is a dependency-free, fail-closed framework for planning and auditing multi-agent research.

It is **not NSA software, NSA-certified, or affiliated with any government agency**. The design goal is high-assurance engineering: strict provenance, independent corroboration, explicit uncertainty, deterministic evidence fingerprints, and CI-enforced validation.

## Architecture

1. **Planner** — converts a mission into scope, definitions, dependency-ordered subquestions, source hierarchy, information-flow rules, acceptance criteria, and failure modes. It performs no research.
2. **Independent investigators** — answer isolated subquestions using primary or authoritative sources.
3. **Evidence ledger** — each source record receives a deterministic SHA-256 fingerprint over canonical metadata and the supporting passage.
4. **Verifier / red-team** — fails closed on invalid records, dangling fingerprints, weak provenance, or insufficient independent corroboration.
5. **Synthesis gate** — a major claim is accepted only when it is `CONFIRMED`; `UNVERIFIED` claims block acceptance.

## Run

Create a plan:

```bash
python -m orchestration.graph_engineering.cli plan \
  --mission "Determine the strongest evidence-backed cybersecurity service ClearGlassInc can sell to Ontario SMEs in 2026."
```

Verify an evidence package:

```bash
python -m orchestration.graph_engineering.cli verify --package research-package.json
```

The verifier returns exit code `0` only when the package satisfies its acceptance gates. Rejected packages return exit code `2`.

## Evidence package

```json
{
  "evidence": [
    {
      "source_title": "Official source title",
      "publisher": "Independent authority A",
      "publication_date": "2026-08-14",
      "url": "https://example.org/source-a",
      "supporting_passage": "Direct supporting material with enough context to audit the claim.",
      "tier": "authoritative"
    }
  ],
  "claims": [
    {
      "claim_id": "C1",
      "text": "The exact claim being tested.",
      "evidence_fingerprints": ["<sha256 fingerprint from Evidence.fingerprint>"],
      "major": true,
      "asserted_confidence": 0.9
    }
  ]
}
```

## Security and epistemic controls

- HTTPS-only evidence URLs.
- ISO date validation.
- Safe claim identifiers.
- No duplicated evidence references.
- No agent prose treated as evidence.
- Major claims require two independent primary/authoritative publishers by default.
- Confidence is capped by evidence strength.
- Invalid evidence is excluded and produces package errors.
- Evidence mutation changes its SHA-256 fingerprint.
- Hashing protects record integrity, not source truth.
- The framework does not fetch sources or claim that a citation is true merely because it is well-formed.

## Research-agent contract

Each investigator should return the direct answer, source title, publisher, publication date, URL, exact supporting passage or data point, confidence, conflicts, assumptions, and unresolved checks. Investigators must not rely on unseen context from other agents.

The verifier should treat every supplied claim as untrusted until the underlying authoritative evidence is independently checked.
