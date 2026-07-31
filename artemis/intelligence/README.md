# Artemis Intelligence Platform

A defensive, governed intelligence foundation for ClearGlassInc.

## Included capabilities

- Evidence objects with provenance, timestamps, reliability, excerpts, and SHA-256 integrity hashes.
- Weighted multi-signal assessments with normalized scores, confidence calculation, explicit decisions, and human-readable explanations.
- Tamper-evident append-only audit chains.
- Defensive entity extraction for emails, URLs, IPv4 addresses, CVEs, and SHA-256 indicators.
- Policy gates that prevent unauthorized high-impact operations.
- Unit tests for scoring, integrity validation, extraction, and authorization enforcement.

## Security boundary

This package does not provide covert surveillance, unauthorized collection, credential theft, exploitation, evasion, persistence, destructive actions, or claims of government classification. `Classification` values are internal data-handling labels only.

## Example

```python
from artemis.intelligence.core import Evidence, IntelligenceEngine, build_signal

evidence = Evidence.build(
    source="approved-public-source",
    text="Verified observation",
    reliability=0.85,
)

assessment = IntelligenceEngine().assess(
    subject="candidate opportunity",
    signals=[
        build_signal("business-impact", 0.90, 3.0, "Strong revenue alignment", [evidence]),
        build_signal("execution-confidence", 0.80, 2.0, "Dependencies verified", [evidence]),
        build_signal("operational-safety", 0.95, 2.5, "Reversible and approved", [evidence]),
    ],
)

print(assessment.to_json())
```

## Validation

From the repository root:

```bash
python -m pytest artemis/intelligence/test_core.py -q
```

The engine is deterministic for the same signal values and weights. IDs and timestamps are intentionally unique per assessment and audit event.
