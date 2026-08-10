"""Content-safe correlation, structured events, metrics, and audit primitives."""
from __future__ import annotations

import contextvars
import json
import re
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Mapping


_correlation_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("correlation_id", default=None)
_VALID_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_FORBIDDEN_FIELDS = frozenset({"body", "content", "email", "message", "payload", "prompt", "secret", "token"})


def correlation_id(candidate: str | None = None) -> str:
    """Set and return a validated request ID, replacing untrusted values."""
    value = candidate if candidate and _VALID_ID.fullmatch(candidate) else uuid.uuid4().hex
    _correlation_id.set(value)
    return value


def current_correlation_id() -> str:
    return _correlation_id.get() or correlation_id()


def structured_event(event: str, fields: Mapping[str, object] | None = None) -> str:
    fields = fields or {}
    forbidden = _FORBIDDEN_FIELDS.intersection(key.lower() for key in fields)
    if forbidden:
        raise ValueError(f"sensitive structured-log fields prohibited: {sorted(forbidden)}")
    record = {"correlation_id": current_correlation_id(), "event": event, **fields}
    return json.dumps(record, sort_keys=True, separators=(",", ":"), default=str)


class JobMetrics:
    """Low-cardinality reference collector; production adapters export these counters."""

    def __init__(self) -> None:
        self._counts: Counter[tuple[str, str]] = Counter()

    def record(self, job_name: str, state: str) -> None:
        self._counts[(job_name, state)] += 1

    def count(self, job_name: str, state: str) -> int:
        return self._counts[(job_name, state)]


@dataclass(frozen=True, slots=True)
class AuditEvent:
    event: str
    job_name: str
    state: str
    correlation_id: str
    occurred_at: str


class AuditRecorder:
    def __init__(self) -> None:
        self.events: list[AuditEvent] = []

    def record(self, *, event: str, job_name: str, state: str) -> AuditEvent:
        item = AuditEvent(event, job_name, state, current_correlation_id(), datetime.now(UTC).isoformat())
        self.events.append(item)
        return item
