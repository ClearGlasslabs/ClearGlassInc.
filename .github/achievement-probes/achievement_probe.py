"""Isolated GitHub achievement validation probe.

This module is intentionally disconnected from application runtime, CI workflows,
deployment configuration, package manifests, and production imports. It provides a
small, deterministic model for recording achievement-validation operations without
modifying existing behavior.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from hashlib import sha256
from json import dumps
from typing import Final, Iterable, Mapping, Sequence


SCHEMA_VERSION: Final[str] = "1.0.0"
PROBE_NAMESPACE: Final[str] = "clearglass.github.achievement-probe"
MAX_NOTE_LENGTH: Final[int] = 280


class Achievement(StrEnum):
    """GitHub achievements represented by this isolated probe."""

    YOLO = "yolo"
    QUICKDRAW = "quickdraw"
    PAIR_EXTRAORDINAIRE = "pair-extraordinaire"
    GALAXY_BRAIN = "galaxy-brain"


class OperationStatus(StrEnum):
    """Normalized status values for a probe operation."""

    PLANNED = "planned"
    EXECUTED = "executed"
    VERIFIED = "verified"
    BLOCKED = "blocked"


@dataclass(frozen=True, slots=True)
class OperationEvidence:
    """Immutable evidence associated with one achievement operation."""

    achievement: Achievement
    status: OperationStatus
    repository: str
    reference: str
    note: str
    observed_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def __post_init__(self) -> None:
        if not self.repository or "/" not in self.repository:
            raise ValueError("repository must use the owner/name format")
        if not self.reference.strip():
            raise ValueError("reference must not be empty")
        if not self.note.strip():
            raise ValueError("note must not be empty")
        if len(self.note) > MAX_NOTE_LENGTH:
            raise ValueError(f"note exceeds {MAX_NOTE_LENGTH} characters")
        if self.observed_at.tzinfo is None:
            raise ValueError("observed_at must be timezone-aware")

    def canonical_payload(self) -> Mapping[str, str]:
        """Return stable, serialization-ready evidence fields."""

        return {
            "achievement": self.achievement.value,
            "status": self.status.value,
            "repository": self.repository,
            "reference": self.reference,
            "note": self.note,
            "observed_at": self.observed_at.astimezone(UTC).isoformat(),
        }

    def digest(self) -> str:
        """Return a deterministic SHA-256 digest of the canonical payload."""

        encoded = dumps(
            self.canonical_payload(),
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return sha256(encoded).hexdigest()


@dataclass(frozen=True, slots=True)
class ProbeReport:
    """Validated collection of achievement operation evidence."""

    repository: str
    operations: tuple[OperationEvidence, ...]
    schema_version: str = SCHEMA_VERSION
    namespace: str = PROBE_NAMESPACE

    def __post_init__(self) -> None:
        if not self.repository or "/" not in self.repository:
            raise ValueError("repository must use the owner/name format")
        if not self.operations:
            raise ValueError("at least one operation is required")
        mismatches = [
            operation.repository
            for operation in self.operations
            if operation.repository != self.repository
        ]
        if mismatches:
            raise ValueError("all operations must target the report repository")

    def status_counts(self) -> Mapping[str, int]:
        """Count operations by normalized status."""

        counts = {status.value: 0 for status in OperationStatus}
        for operation in self.operations:
            counts[operation.status.value] += 1
        return counts

    def achievements(self) -> tuple[str, ...]:
        """Return achievement names in deterministic order."""

        return tuple(
            sorted({operation.achievement.value for operation in self.operations})
        )

    def report_digest(self) -> str:
        """Return a digest derived from ordered operation digests."""

        joined = "\n".join(operation.digest() for operation in self.operations)
        return sha256(joined.encode("utf-8")).hexdigest()

    def as_dict(self) -> Mapping[str, object]:
        """Return the complete report as a JSON-compatible mapping."""

        return {
            "schema_version": self.schema_version,
            "namespace": self.namespace,
            "repository": self.repository,
            "achievements": self.achievements(),
            "status_counts": self.status_counts(),
            "report_digest": self.report_digest(),
            "operations": [
                {
                    **operation.canonical_payload(),
                    "digest": operation.digest(),
                }
                for operation in self.operations
            ],
        }

    def to_json(self, *, indent: int = 2) -> str:
        """Serialize the report with stable key ordering."""

        if indent < 0:
            raise ValueError("indent must be zero or greater")
        return dumps(self.as_dict(), indent=indent, sort_keys=True)


def build_report(
    repository: str,
    operations: Iterable[OperationEvidence],
) -> ProbeReport:
    """Build a validated report from any iterable of operation evidence."""

    materialized = tuple(operations)
    return ProbeReport(repository=repository, operations=materialized)


def summarize(report: ProbeReport) -> str:
    """Return a compact deterministic human-readable report summary."""

    counts = report.status_counts()
    achievements = ", ".join(report.achievements())
    return (
        f"repository={report.repository}; "
        f"achievements={achievements}; "
        f"executed={counts[OperationStatus.EXECUTED.value]}; "
        f"verified={counts[OperationStatus.VERIFIED.value]}; "
        f"blocked={counts[OperationStatus.BLOCKED.value]}; "
        f"digest={report.report_digest()}"
    )


def validate_unique_references(
    operations: Sequence[OperationEvidence],
) -> None:
    """Reject duplicate operation references."""

    references = [operation.reference for operation in operations]
    duplicates = sorted(
        reference for reference in set(references) if references.count(reference) > 1
    )
    if duplicates:
        joined = ", ".join(duplicates)
        raise ValueError(f"duplicate references detected: {joined}")


def main() -> int:
    """Run a deterministic local demonstration without network access."""

    repository = "ClearGlasslabs/ClearGlassInc."
    operations = (
        OperationEvidence(
            achievement=Achievement.YOLO,
            status=OperationStatus.PLANNED,
            repository=repository,
            reference="pull-request:pending",
            note="Isolated additive test PR intended for immediate merge without review.",
        ),
        OperationEvidence(
            achievement=Achievement.QUICKDRAW,
            status=OperationStatus.PLANNED,
            repository=repository,
            reference="issue:pending",
            note="Disposable issue intended to be opened and immediately closed.",
        ),
        OperationEvidence(
            achievement=Achievement.PAIR_EXTRAORDINAIRE,
            status=OperationStatus.PLANNED,
            repository=repository,
            reference="commit:pending",
            note="Commit includes a recognized GitHub co-author trailer.",
        ),
        OperationEvidence(
            achievement=Achievement.GALAXY_BRAIN,
            status=OperationStatus.BLOCKED,
            repository=repository,
            reference="discussion:connector-unavailable",
            note="Requires two accepted GitHub Discussion answers and repository discussion access.",
        ),
    )
    validate_unique_references(operations)
    report = build_report(repository, operations)
    print(report.to_json())
    print(summarize(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
