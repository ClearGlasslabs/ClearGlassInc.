import json

import pytest

from artemis.idempotency import IdempotencyConflict, IdempotencyStore
from artemis.job_registry import JobRegistry, JobState, REGISTRY
from artemis.observability import AuditRecorder, JobMetrics, correlation_id, structured_event
from artemis.policy import policy_check


def test_registry_has_complete_fail_closed_submission_jobs():
    for name in ("contact-form.submit", "project-brief.submit", "external-webhook.receive", "notification.prepare"):
        job = REGISTRY.get(name)
        assert job.owner and job.timeout_seconds and job.retention_days
        assert job.idempotency_required and job.audit_required
        assert not job.enabled_by_default
        assert job.initial_state is JobState.DISABLED


def test_registry_rejects_duplicate_names():
    job = REGISTRY.get("evaluation.run")
    with pytest.raises(ValueError, match="duplicate job"):
        JobRegistry((job, job))


def test_structured_events_propagate_safe_correlation_ids_and_reject_content():
    assert correlation_id("request-123") == "request-123"
    assert json.loads(structured_event("job.started", {"job_name": "evaluation.run"})) == {
        "correlation_id": "request-123",
        "event": "job.started",
        "job_name": "evaluation.run",
    }
    assert correlation_id("bad id with spaces") != "bad id with spaces"
    with pytest.raises(ValueError, match="sensitive"):
        structured_event("bad", {"payload": "classified text"})


def test_duplicate_submission_executes_once_and_emits_metrics_and_audit():
    store, metrics, audit = IdempotencyStore(), JobMetrics(), AuditRecorder()
    calls = []

    def operation():
        calls.append("called")
        return {"submission_id": "staged-1"}

    args = dict(job_name="contact-form.submit", key="key-1", request={"form_id": "f-1"},
                operation=operation, ttl_seconds=60, metrics=metrics, audit=audit)
    first = store.execute(**args)
    second = store.execute(**args)

    assert first.value == second.value and not first.duplicate and second.duplicate
    assert calls == ["called"]
    assert metrics.count("contact-form.submit", "succeeded") == 1
    assert metrics.count("contact-form.submit", "duplicate") == 1
    assert [event.event for event in audit.events] == ["job.completed", "job.duplicate_suppressed"]


def test_key_reuse_with_changed_request_fails_closed():
    store, metrics, audit = IdempotencyStore(), JobMetrics(), AuditRecorder()
    common = dict(job_name="external-webhook.receive", key="delivery-1", operation=lambda: "quarantined",
                  ttl_seconds=60, metrics=metrics, audit=audit)
    store.execute(request={"digest": "one"}, **common)
    with pytest.raises(IdempotencyConflict):
        store.execute(request={"digest": "two"}, **common)
    assert metrics.count("external-webhook.receive", "idempotency_conflict") == 1
    assert audit.events[-1].event == "job.idempotency_conflict"


def test_expired_key_can_be_safely_reused():
    now = [10.0]
    store, metrics, audit = IdempotencyStore(clock=lambda: now[0]), JobMetrics(), AuditRecorder()
    calls = []
    kwargs = dict(job_name="project-brief.submit", key="brief-1", request={"version": 1},
                  operation=lambda: calls.append(1) or len(calls), ttl_seconds=5, metrics=metrics, audit=audit)
    assert store.execute(**kwargs).value == 1
    now[0] = 16.0
    assert store.execute(**kwargs).value == 2


@pytest.mark.parametrize(
    ("actor_clearance", "resource_classification", "reason"),
    [
        ("INVALID", "UNCL", "invalid actor clearance"),
        ("TS", "UNKNOWN", "invalid resource classification"),
        (None, "UNCL", "invalid actor clearance"),
        ("TS", None, "invalid resource classification"),
    ],
)
def test_policy_fails_closed_for_missing_or_unknown_classifications(
    actor_clearance, resource_classification, reason
):
    decision = policy_check(
        actor_id="operator-1",
        action="ontology.read",
        actor={"clearance": actor_clearance, "coalition_scope": ["US"]},
        resource={"classification": resource_classification, "coalition_scope": ["US"]},
    )

    assert not decision.allow
    assert decision.reason == reason


def test_policy_fails_closed_for_malformed_coalition_scopes():
    decision = policy_check(
        actor_id="operator-1",
        action="ontology.read",
        actor={"clearance": "TS", "coalition_scope": ["US", {"unexpected": "object"}]},
        resource={"classification": "SECRET", "coalition_scope": ["US"]},
    )

    assert not decision.allow
    assert decision.reason == "invalid actor coalition scope"


@pytest.mark.parametrize("confidence", [None, "high", True, -0.1, 1.1])
def test_execution_policy_fails_closed_for_invalid_confidence(confidence):
    decision = policy_check(
        actor_id="operator-1",
        action="action.execute",
        actor={"clearance": "TS", "coalition_scope": ["US"]},
        resource={"classification": "SECRET", "coalition_scope": ["US"]},
        context={"human_approval_token": "approved", "confidence": confidence},
    )

    assert not decision.allow
    assert decision.reason == "invalid confidence"
