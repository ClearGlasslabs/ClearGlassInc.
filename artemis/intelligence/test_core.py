from artemis.intelligence.core import (
    AuditChain,
    Classification,
    Decision,
    EntityExtractor,
    Evidence,
    IntelligenceEngine,
    PolicyGate,
    build_signal,
)


def test_assessment_is_deterministic_and_explainable() -> None:
    evidence = Evidence.build("unit-test", "verified public source", 0.9)
    signals = [
        build_signal("relevance", 0.9, 3, "direct match", [evidence]),
        build_signal("reliability", 0.8, 2, "trusted provenance", [evidence]),
        build_signal("risk", 0.7, 1, "bounded downside", [evidence]),
    ]
    result = IntelligenceEngine().assess(
        subject="defensive intelligence task",
        signals=signals,
        classification=Classification.INTERNAL,
    )
    assert result.decision is Decision.ACCEPT
    assert 0.0 <= result.score <= 1.0
    assert 0.0 <= result.confidence <= 1.0
    assert len(result.audit_hash) == 64
    assert len(result.explanation) == 3


def test_audit_chain_detects_tampering() -> None:
    chain = AuditChain()
    chain.append(actor="artemis", action="analyze", target="sample", outcome="success")
    chain.append(actor="artemis", action="report", target="sample", outcome="success")
    assert chain.verify()
    chain._events[0].outcome = "tampered"  # deliberate integrity test
    assert not chain.verify()


def test_entity_extractor() -> None:
    entities = EntityExtractor().extract(
        "Contact ops@example.com at https://example.com. IOC 203.0.113.5 CVE-2026-12345."
    )
    assert entities["emails"] == ["ops@example.com"]
    assert entities["ipv4"] == ["203.0.113.5"]
    assert entities["cves"] == ["CVE-2026-12345"]


def test_policy_gate_blocks_unauthorized_high_impact_action() -> None:
    allowed, reasons = PolicyGate().evaluate(
        action="deploy_production",
        authorized=False,
        reversible=False,
        evidence_count=1,
    )
    assert not allowed
    assert len(reasons) == 2
