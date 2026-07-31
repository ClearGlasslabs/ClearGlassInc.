"""Governed intelligence primitives for Artemis.

This module intentionally provides defensive, auditable analysis components only.
It does not perform covert collection, unauthorized access, surveillance, or
production mutation. Every result carries provenance and confidence metadata.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from enum import Enum
from hashlib import sha256
from typing import Any, Iterable, Mapping, Sequence
import json
import math
import re
import uuid


class Classification(str, Enum):
    PUBLIC = "PUBLIC"
    INTERNAL = "INTERNAL"
    CONFIDENTIAL = "CONFIDENTIAL"
    RESTRICTED = "RESTRICTED"


class Decision(str, Enum):
    ACCEPT = "ACCEPT"
    REVIEW = "REVIEW"
    REJECT = "REJECT"


@dataclass(frozen=True, slots=True)
class Evidence:
    source: str
    collected_at: str
    content_hash: str
    excerpt: str
    reliability: float

    @classmethod
    def build(cls, source: str, text: str, reliability: float = 0.5) -> "Evidence":
        normalized = " ".join(text.split())
        return cls(
            source=source,
            collected_at=datetime.now(UTC).isoformat(),
            content_hash=sha256(normalized.encode("utf-8")).hexdigest(),
            excerpt=normalized[:500],
            reliability=_clamp(reliability),
        )


@dataclass(frozen=True, slots=True)
class Signal:
    name: str
    value: float
    weight: float
    rationale: str
    evidence: tuple[Evidence, ...] = ()

    @property
    def weighted_value(self) -> float:
        return _clamp(self.value) * max(0.0, self.weight)


@dataclass(frozen=True, slots=True)
class Assessment:
    assessment_id: str
    subject: str
    score: float
    confidence: float
    decision: Decision
    classification: Classification
    signals: tuple[Signal, ...]
    created_at: str
    audit_hash: str
    explanation: tuple[str, ...]

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, sort_keys=True)


@dataclass(slots=True)
class AuditEvent:
    event_id: str
    timestamp: str
    actor: str
    action: str
    target: str
    outcome: str
    metadata: dict[str, Any] = field(default_factory=dict)
    previous_hash: str = "GENESIS"
    event_hash: str = ""

    def seal(self) -> "AuditEvent":
        canonical = json.dumps(
            {
                "event_id": self.event_id,
                "timestamp": self.timestamp,
                "actor": self.actor,
                "action": self.action,
                "target": self.target,
                "outcome": self.outcome,
                "metadata": self.metadata,
                "previous_hash": self.previous_hash,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        self.event_hash = sha256(canonical.encode("utf-8")).hexdigest()
        return self


class AuditChain:
    """Append-only tamper-evident event chain."""

    def __init__(self) -> None:
        self._events: list[AuditEvent] = []

    def append(
        self,
        *,
        actor: str,
        action: str,
        target: str,
        outcome: str,
        metadata: Mapping[str, Any] | None = None,
    ) -> AuditEvent:
        event = AuditEvent(
            event_id=str(uuid.uuid4()),
            timestamp=datetime.now(UTC).isoformat(),
            actor=actor,
            action=action,
            target=target,
            outcome=outcome,
            metadata=dict(metadata or {}),
            previous_hash=self._events[-1].event_hash if self._events else "GENESIS",
        ).seal()
        self._events.append(event)
        return event

    def verify(self) -> bool:
        previous = "GENESIS"
        for event in self._events:
            expected = AuditEvent(
                event_id=event.event_id,
                timestamp=event.timestamp,
                actor=event.actor,
                action=event.action,
                target=event.target,
                outcome=event.outcome,
                metadata=dict(event.metadata),
                previous_hash=previous,
            ).seal().event_hash
            if event.previous_hash != previous or event.event_hash != expected:
                return False
            previous = event.event_hash
        return True

    def export(self) -> list[dict[str, Any]]:
        return [asdict(event) for event in self._events]


class IntelligenceEngine:
    """Deterministic weighted-signal assessment engine."""

    def __init__(
        self,
        *,
        accept_threshold: float = 0.70,
        review_threshold: float = 0.40,
        minimum_confidence: float = 0.45,
    ) -> None:
        if not 0 <= review_threshold <= accept_threshold <= 1:
            raise ValueError("thresholds must satisfy 0 <= review <= accept <= 1")
        self.accept_threshold = accept_threshold
        self.review_threshold = review_threshold
        self.minimum_confidence = _clamp(minimum_confidence)

    def assess(
        self,
        *,
        subject: str,
        signals: Sequence[Signal],
        classification: Classification = Classification.INTERNAL,
    ) -> Assessment:
        if not subject.strip():
            raise ValueError("subject is required")
        if not signals:
            raise ValueError("at least one signal is required")

        total_weight = sum(max(0.0, signal.weight) for signal in signals)
        if total_weight <= 0:
            raise ValueError("at least one positive signal weight is required")

        score = sum(signal.weighted_value for signal in signals) / total_weight
        evidence_values = [e.reliability for s in signals for e in s.evidence]
        evidence_confidence = sum(evidence_values) / len(evidence_values) if evidence_values else 0.25
        coverage = min(1.0, len(signals) / 5.0)
        disagreement = _weighted_stddev(signals, score)
        confidence = _clamp((0.55 * evidence_confidence) + (0.35 * coverage) + (0.10 * (1 - disagreement)))

        if confidence < self.minimum_confidence:
            decision = Decision.REVIEW
        elif score >= self.accept_threshold:
            decision = Decision.ACCEPT
        elif score >= self.review_threshold:
            decision = Decision.REVIEW
        else:
            decision = Decision.REJECT

        explanation = tuple(
            f"{signal.name}: value={_clamp(signal.value):.3f}, weight={max(0.0, signal.weight):.3f}, rationale={signal.rationale}"
            for signal in sorted(signals, key=lambda item: item.weighted_value, reverse=True)
        )
        canonical = json.dumps(
            {
                "subject": subject,
                "score": round(score, 8),
                "confidence": round(confidence, 8),
                "decision": decision.value,
                "classification": classification.value,
                "signals": [asdict(signal) for signal in signals],
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return Assessment(
            assessment_id=str(uuid.uuid4()),
            subject=subject,
            score=round(score, 6),
            confidence=round(confidence, 6),
            decision=decision,
            classification=classification,
            signals=tuple(signals),
            created_at=datetime.now(UTC).isoformat(),
            audit_hash=sha256(canonical.encode("utf-8")).hexdigest(),
            explanation=explanation,
        )


class EntityExtractor:
    """Small deterministic extractor for defensive triage and document analysis."""

    EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
    URL = re.compile(r"\bhttps?://[^\s<>()]+", re.IGNORECASE)
    IPV4 = re.compile(r"\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b")
    CVE = re.compile(r"\bCVE-\d{4}-\d{4,7}\b", re.IGNORECASE)
    SHA256 = re.compile(r"\b[a-f0-9]{64}\b", re.IGNORECASE)

    def extract(self, text: str) -> dict[str, list[str]]:
        if not isinstance(text, str):
            raise TypeError("text must be a string")
        return {
            "emails": sorted(set(self.EMAIL.findall(text))),
            "urls": sorted(set(self.URL.findall(text))),
            "ipv4": sorted(set(self.IPV4.findall(text))),
            "cves": sorted({value.upper() for value in self.CVE.findall(text)}),
            "sha256": sorted({value.lower() for value in self.SHA256.findall(text)}),
        }


class PolicyGate:
    """Explicit authorization gate for high-impact operations."""

    HIGH_IMPACT_ACTIONS = {
        "deploy_production",
        "merge_protected_branch",
        "delete_resource",
        "rotate_secret",
        "change_access_control",
        "send_external_message",
        "financial_transaction",
        "collect_personal_data",
    }

    def evaluate(
        self,
        *,
        action: str,
        authorized: bool,
        reversible: bool,
        evidence_count: int,
    ) -> tuple[bool, tuple[str, ...]]:
        reasons: list[str] = []
        if action in self.HIGH_IMPACT_ACTIONS and not authorized:
            reasons.append("explicit authorization is required")
        if action in self.HIGH_IMPACT_ACTIONS and not reversible:
            reasons.append("irreversible high-impact action requires manual approval")
        if evidence_count < 1:
            reasons.append("at least one evidence record is required")
        return (not reasons, tuple(reasons))


def build_signal(
    name: str,
    value: float,
    weight: float,
    rationale: str,
    evidence: Iterable[Evidence] = (),
) -> Signal:
    if not name.strip():
        raise ValueError("signal name is required")
    if not rationale.strip():
        raise ValueError("signal rationale is required")
    if weight < 0:
        raise ValueError("signal weight cannot be negative")
    return Signal(name, _clamp(value), weight, rationale, tuple(evidence))


def _clamp(value: float) -> float:
    if not math.isfinite(value):
        raise ValueError("value must be finite")
    return max(0.0, min(1.0, float(value)))


def _weighted_stddev(signals: Sequence[Signal], mean: float) -> float:
    total_weight = sum(max(0.0, signal.weight) for signal in signals)
    variance = sum(max(0.0, signal.weight) * ((_clamp(signal.value) - mean) ** 2) for signal in signals) / total_weight
    return min(1.0, math.sqrt(variance))
