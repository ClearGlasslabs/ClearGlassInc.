"""Thread-safe, expiring duplicate-submission control for side-effect boundaries."""
from __future__ import annotations

import hashlib
import json
import threading
import time
from dataclasses import dataclass
from typing import Callable, Generic, Mapping, TypeVar

from artemis.observability import AuditRecorder, JobMetrics


T = TypeVar("T")


class IdempotencyConflict(RuntimeError):
    """A key was reused with a different normalized request."""


@dataclass(frozen=True, slots=True)
class SubmissionResult(Generic[T]):
    value: T
    duplicate: bool


@dataclass(slots=True)
class _Record(Generic[T]):
    fingerprint: str
    value: T
    expires_at: float


def request_fingerprint(request: Mapping[str, object]) -> str:
    encoded = json.dumps(request, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(encoded).hexdigest()


class IdempotencyStore:
    """Reference store. Deployments replace it with an atomic durable store."""

    def __init__(self, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._records: dict[tuple[str, str], _Record[object]] = {}
        self._lock = threading.Lock()

    def execute(
        self,
        *,
        job_name: str,
        key: str,
        request: Mapping[str, object],
        operation: Callable[[], T],
        ttl_seconds: int,
        metrics: JobMetrics,
        audit: AuditRecorder,
    ) -> SubmissionResult[T]:
        if not key or len(key) > 128:
            raise ValueError("idempotency key must contain 1 to 128 characters")
        if ttl_seconds <= 0:
            raise ValueError("idempotency TTL must be positive")
        fingerprint = request_fingerprint(request)
        identity = (job_name, key)
        with self._lock:
            existing = self._records.get(identity)
            if existing and existing.expires_at > self._clock():
                if existing.fingerprint != fingerprint:
                    metrics.record(job_name, "idempotency_conflict")
                    audit.record(event="job.idempotency_conflict", job_name=job_name, state="failed")
                    raise IdempotencyConflict("idempotency key reused with a different request")
                metrics.record(job_name, "duplicate")
                audit.record(event="job.duplicate_suppressed", job_name=job_name, state="succeeded")
                return SubmissionResult(existing.value, duplicate=True)  # type: ignore[arg-type]

            value = operation()
            self._records[identity] = _Record(fingerprint, value, self._clock() + ttl_seconds)
            metrics.record(job_name, "succeeded")
            audit.record(event="job.completed", job_name=job_name, state="succeeded")
            return SubmissionResult(value, duplicate=False)
