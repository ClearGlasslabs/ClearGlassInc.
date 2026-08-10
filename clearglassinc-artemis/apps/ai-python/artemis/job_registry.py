"""Typed inventory of bounded Artemis background jobs.

The registry is configuration, not a scheduler.  In particular, entries whose feature
flag is disabled must never be interpreted as permission to contact an external system.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class JobState(str, Enum):
    LOADING = "loading"
    RETRYING = "retrying"
    DELAYED = "delayed"
    FAILED = "failed"
    DEAD_LETTERED = "dead-lettered"
    DISABLED = "disabled"
    MANUAL_REVIEW_REQUIRED = "manual-review-required"
    SUCCEEDED = "succeeded"


class Trigger(str, Enum):
    HTTP = "http"
    EVENT = "event"
    SCHEDULE = "schedule"
    MANUAL = "manual"


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    attempts: int
    initial_backoff_seconds: int
    maximum_backoff_seconds: int

    def __post_init__(self) -> None:
        if self.attempts < 0 or self.initial_backoff_seconds < 0:
            raise ValueError("retry values cannot be negative")
        if self.maximum_backoff_seconds < self.initial_backoff_seconds:
            raise ValueError("maximum backoff must be at least the initial backoff")


@dataclass(frozen=True, slots=True)
class JobDefinition:
    name: str
    purpose: str
    owner: str
    trigger: Trigger
    feature_flag: str
    enabled_by_default: bool
    timeout_seconds: int
    retry: RetryPolicy
    idempotency_required: bool
    retention_days: int
    audit_required: bool
    initial_state: JobState

    def __post_init__(self) -> None:
        required = (self.name, self.purpose, self.owner, self.feature_flag)
        if not all(value.strip() for value in required):
            raise ValueError("job identity, purpose, owner, and feature flag are required")
        if self.timeout_seconds <= 0 or self.retention_days <= 0:
            raise ValueError("timeout and retention must be positive")
        if not self.audit_required:
            raise ValueError("all Artemis jobs require audit events")


class JobRegistry:
    def __init__(self, definitions: tuple[JobDefinition, ...]) -> None:
        self._jobs: dict[str, JobDefinition] = {}
        for definition in definitions:
            if definition.name in self._jobs:
                raise ValueError(f"duplicate job: {definition.name}")
            self._jobs[definition.name] = definition

    def get(self, name: str) -> JobDefinition:
        try:
            return self._jobs[name]
        except KeyError as exc:
            raise KeyError(f"unregistered job: {name}") from exc

    def all(self) -> tuple[JobDefinition, ...]:
        return tuple(self._jobs[name] for name in sorted(self._jobs))


_SAFE_RETRY = RetryPolicy(attempts=2, initial_backoff_seconds=1, maximum_backoff_seconds=10)


def _submission(name: str, purpose: str, flag: str) -> JobDefinition:
    return JobDefinition(
        name=name,
        purpose=purpose,
        owner="platform-operations",
        trigger=Trigger.HTTP,
        feature_flag=flag,
        enabled_by_default=False,
        timeout_seconds=10,
        retry=_SAFE_RETRY,
        idempotency_required=True,
        retention_days=30,
        audit_required=True,
        initial_state=JobState.DISABLED,
    )


REGISTRY = JobRegistry(
    (
        _submission("contact-form.submit", "Validate and stage a contact request", "contact_intake"),
        _submission("project-brief.submit", "Validate and stage a project brief", "project_brief_intake"),
        _submission("external-webhook.receive", "Validate and quarantine a webhook", "external_webhooks"),
        _submission("notification.prepare", "Prepare, but never deliver, a notification", "notifications"),
        JobDefinition(
            name="evaluation.run",
            purpose="Evaluate a versioned candidate against an approved offline dataset",
            owner="ai-governance",
            trigger=Trigger.MANUAL,
            feature_flag="offline_evaluations",
            enabled_by_default=True,
            timeout_seconds=900,
            retry=RetryPolicy(1, 5, 30),
            idempotency_required=True,
            retention_days=365,
            audit_required=True,
            initial_state=JobState.LOADING,
        ),
    )
)
