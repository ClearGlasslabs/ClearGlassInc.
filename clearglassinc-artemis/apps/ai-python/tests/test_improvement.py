import pytest

from artemis.improvement import (
    ArtifactRef,
    ChangeProposal,
    ChangeState,
    EvaluationGate,
    HashChainAuditSink,
    ImprovementController,
)


def artifact(version: str) -> ArtifactRef:
    return ArtifactRef("prompt_bundle", version, f"sha256:{version}")


def passing_gate() -> EvaluationGate:
    return EvaluationGate("eval:v7", 0.91, 0.87, 0.08, 620)


def test_upgrade_requires_evaluation_and_two_distinct_human_approvals():
    audit = HashChainAuditSink()
    controller = ImprovementController(audit)
    proposal = ChangeProposal(artifact("v8"), artifact("v7"), "reduce false positives", ("fb-1",))

    controller.evaluate(proposal, passing_gate())
    controller.approve(proposal, reviewer_id="reviewer-a", proposer_id="agent-proposer")
    assert proposal.state == ChangeState.AWAITING_APPROVAL
    controller.approve(proposal, reviewer_id="reviewer-b", proposer_id="agent-proposer")
    controller.start_canary(proposal, current_version="v7")
    controller.finish_canary(proposal, passing_gate())

    assert proposal.state == ChangeState.PROMOTED
    assert proposal.rollback_version == "v7"
    assert len(audit.events) == 5
    assert audit.events[-1]["previous_hash"] == audit.events[-2]["event_hash"]


def test_failed_live_gate_rolls_back_and_self_approval_is_denied():
    controller = ImprovementController(HashChainAuditSink(), required_approvals=1)
    proposal = ChangeProposal(artifact("v8"), artifact("v7"), "routing candidate", ("outcome-2",))
    controller.evaluate(proposal, passing_gate())

    with pytest.raises(PermissionError):
        controller.approve(proposal, reviewer_id="author", proposer_id="author")

    controller.approve(proposal, reviewer_id="reviewer", proposer_id="author")
    controller.start_canary(proposal, current_version="v7")
    controller.finish_canary(
        proposal,
        EvaluationGate("eval:v7", 0.70, 0.88, 0.20, 700),
    )
    assert proposal.state == ChangeState.ROLLED_BACK
