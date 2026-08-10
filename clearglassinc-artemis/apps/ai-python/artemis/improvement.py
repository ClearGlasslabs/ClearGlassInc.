"""Governed self-improvement control plane for ClearGlassInc Artemis.

This module deliberately stops at *promotion authorization*.  Apollo performs the
deployment; an AI agent can create a proposal, but cannot approve or deploy it.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Protocol
from uuid import uuid4


class ChangeState(str, Enum):
    DRAFT = "DRAFT"
    EVALUATED = "EVALUATED"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANARY = "CANARY"
    PROMOTED = "PROMOTED"
    ROLLED_BACK = "ROLLED_BACK"


@dataclass(frozen=True)
class ArtifactRef:
    kind: str
    version: str
    digest: str


@dataclass(frozen=True)
class EvaluationGate:
    suite_version: str
    precision: float
    recall: float
    false_positive_rate: float
    latency_p95_ms: float
    policy_violations: int = 0

    def passes(self) -> bool:
        return (
            self.precision >= 0.86
            and self.recall >= 0.80
            and self.false_positive_rate <= 0.14
            and self.latency_p95_ms <= 1_500
            and self.policy_violations == 0
        )


@dataclass
class ChangeProposal:
    artifact: ArtifactRef
    baseline: ArtifactRef
    rationale: str
    evidence_ids: tuple[str, ...]
    id: str = field(default_factory=lambda: str(uuid4()))
    state: ChangeState = ChangeState.DRAFT
    evaluation: EvaluationGate | None = None
    approvals: list[str] = field(default_factory=list)
    rollback_version: str | None = None


class AuditSink(Protocol):
    def append(self, event: dict[str, Any]) -> str: ...


class HashChainAuditSink:
    """Reference append-only ledger; production writes the same envelope to WORM."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self._head = "0" * 64

    def append(self, event: dict[str, Any]) -> str:
        envelope = {
            **event,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
            "previous_hash": self._head,
        }
        canonical = json.dumps(envelope, sort_keys=True, separators=(",", ":"))
        self._head = hashlib.sha256(canonical.encode()).hexdigest()
        envelope["event_hash"] = self._head
        self.events.append(envelope)
        return self._head


class ImprovementController:
    """State machine enforcing eval, separation-of-duties, and rollback gates."""

    def __init__(self, audit: AuditSink, required_approvals: int = 2) -> None:
        self.audit = audit
        self.required_approvals = required_approvals

    def evaluate(self, proposal: ChangeProposal, gate: EvaluationGate) -> ChangeProposal:
        self._require(proposal, ChangeState.DRAFT)
        proposal.evaluation = gate
        proposal.state = ChangeState.AWAITING_APPROVAL if gate.passes() else ChangeState.REJECTED
        self._record(proposal, "proposal.evaluated", {"passed": gate.passes()})
        return proposal

    def approve(self, proposal: ChangeProposal, *, reviewer_id: str, proposer_id: str) -> ChangeProposal:
        self._require(proposal, ChangeState.AWAITING_APPROVAL)
        if reviewer_id == proposer_id:
            raise PermissionError("proposal authors cannot approve their own change")
        if reviewer_id not in proposal.approvals:
            proposal.approvals.append(reviewer_id)
        if len(proposal.approvals) >= self.required_approvals:
            proposal.state = ChangeState.APPROVED
        self._record(proposal, "proposal.approved", {"reviewer_id": reviewer_id})
        return proposal

    def start_canary(self, proposal: ChangeProposal, *, current_version: str) -> ChangeProposal:
        self._require(proposal, ChangeState.APPROVED)
        proposal.rollback_version = current_version
        proposal.state = ChangeState.CANARY
        self._record(proposal, "deployment.canary_started", {"rollback": current_version})
        return proposal

    def finish_canary(self, proposal: ChangeProposal, live_gate: EvaluationGate) -> ChangeProposal:
        self._require(proposal, ChangeState.CANARY)
        proposal.state = ChangeState.PROMOTED if live_gate.passes() else ChangeState.ROLLED_BACK
        self._record(proposal, "deployment.promoted" if live_gate.passes() else "deployment.rolled_back", {})
        return proposal

    @staticmethod
    def _require(proposal: ChangeProposal, expected: ChangeState) -> None:
        if proposal.state != expected:
            raise ValueError(f"expected {expected}, got {proposal.state}")

    def _record(self, proposal: ChangeProposal, event_type: str, details: dict[str, Any]) -> None:
        self.audit.append(
            {
                "event_type": event_type,
                "proposal_id": proposal.id,
                "artifact_digest": proposal.artifact.digest,
                "state": proposal.state.value,
                "details": details,
            }
        )
