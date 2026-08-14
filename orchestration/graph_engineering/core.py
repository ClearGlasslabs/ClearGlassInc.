from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from enum import Enum
from hashlib import sha256
from typing import Iterable
from urllib.parse import urlparse
import json
import re


class EvidenceTier(str, Enum):
    PRIMARY = "primary"
    AUTHORITATIVE = "authoritative"
    SECONDARY = "secondary"
    UNKNOWN = "unknown"


class ClaimVerdict(str, Enum):
    CONFIRMED = "confirmed"
    PARTLY_CONFIRMED = "partly_confirmed"
    UNVERIFIED = "unverified"
    CONTRADICTED = "contradicted"


@dataclass(frozen=True)
class Evidence:
    source_title: str
    publisher: str
    publication_date: str
    url: str
    supporting_passage: str
    tier: EvidenceTier
    retrieved_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    )

    def validate(self) -> list[str]:
        errors: list[str] = []
        parsed = urlparse(self.url)
        if parsed.scheme != "https" or not parsed.netloc:
            errors.append("source URL must be absolute HTTPS")
        if len(self.supporting_passage.strip()) < 20:
            errors.append("supporting passage is too short")
        try:
            date.fromisoformat(self.publication_date)
        except ValueError:
            errors.append("publication_date must be YYYY-MM-DD")
        if not self.source_title.strip():
            errors.append("source title is required")
        if not self.publisher.strip():
            errors.append("publisher is required")
        return errors

    @property
    def fingerprint(self) -> str:
        canonical = {
            "publisher": self.publisher.strip().casefold(),
            "publication_date": self.publication_date,
            "source_title": self.source_title.strip(),
            "supporting_passage": re.sub(r"\s+", " ", self.supporting_passage.strip()),
            "tier": self.tier.value,
            "url": self.url.strip(),
        }
        encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return sha256(encoded).hexdigest()


@dataclass(frozen=True)
class Claim:
    claim_id: str
    text: str
    evidence_fingerprints: tuple[str, ...] = ()
    major: bool = True
    asserted_confidence: float = 0.0

    def validate(self) -> list[str]:
        errors: list[str] = []
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", self.claim_id):
            errors.append("claim_id must be 1-64 safe identifier characters")
        if len(self.text.strip()) < 8:
            errors.append("claim text is too short")
        if isinstance(self.asserted_confidence, bool) or not 0.0 <= self.asserted_confidence <= 1.0:
            errors.append("asserted_confidence must be between 0 and 1")
        if len(set(self.evidence_fingerprints)) != len(self.evidence_fingerprints):
            errors.append("duplicate evidence fingerprints are not allowed")
        return errors


@dataclass(frozen=True)
class ClaimAudit:
    claim_id: str
    verdict: ClaimVerdict
    confidence: float
    reasons: tuple[str, ...]
    accepted_evidence: tuple[str, ...]


@dataclass(frozen=True)
class VerificationReport:
    accepted: bool
    claim_audits: tuple[ClaimAudit, ...]
    package_errors: tuple[str, ...]

    def to_dict(self) -> dict:
        return {
            "accepted": self.accepted,
            "package_errors": list(self.package_errors),
            "claim_audits": [
                {
                    **asdict(audit),
                    "verdict": audit.verdict.value,
                    "reasons": list(audit.reasons),
                    "accepted_evidence": list(audit.accepted_evidence),
                }
                for audit in self.claim_audits
            ],
        }


@dataclass(frozen=True)
class ResearchPlan:
    mission: str
    scope: tuple[str, ...]
    definitions: dict[str, str]
    subquestions: tuple[dict[str, object], ...]
    source_hierarchy: tuple[str, ...]
    information_flow_rules: tuple[str, ...]
    acceptance_criteria: tuple[str, ...]
    risks: tuple[str, ...]
    created_at: str

    def to_dict(self) -> dict:
        return {
            **asdict(self),
            "scope": list(self.scope),
            "subquestions": list(self.subquestions),
            "source_hierarchy": list(self.source_hierarchy),
            "information_flow_rules": list(self.information_flow_rules),
            "acceptance_criteria": list(self.acceptance_criteria),
            "risks": list(self.risks),
        }


class Planner:
    """Builds a fail-closed graph-engineering plan without performing research."""

    @staticmethod
    def create(mission: str) -> ResearchPlan:
        clean = re.sub(r"\s+", " ", mission).strip()
        if len(clean) < 12:
            raise ValueError("mission must be explicit and at least 12 characters")

        subquestions = (
            {
                "id": "Q1",
                "role": "scope-and-ontology",
                "question": "What terms, entities, boundaries, and decision criteria govern the mission?",
                "depends_on": [],
            },
            {
                "id": "Q2",
                "role": "primary-source-investigator",
                "question": "What primary or authoritative evidence directly establishes the core facts?",
                "depends_on": ["Q1"],
            },
            {
                "id": "Q3",
                "role": "quantitative-investigator",
                "question": "What measurable data, dates, figures, and trends materially affect the answer?",
                "depends_on": ["Q1"],
            },
            {
                "id": "Q4",
                "role": "counterevidence-investigator",
                "question": "What credible evidence conflicts with, limits, or falsifies the leading interpretation?",
                "depends_on": ["Q2", "Q3"],
            },
            {
                "id": "Q5",
                "role": "independent-verifier",
                "question": "Which claims survive independent source validation and adversarial review?",
                "depends_on": ["Q2", "Q3", "Q4"],
            },
        )

        return ResearchPlan(
            mission=clean,
            scope=(
                "Answer only the stated mission and directly necessary subquestions.",
                "Prefer current primary and authoritative evidence.",
                "Keep facts, inferences, assumptions, and unknowns explicitly separated.",
            ),
            definitions={
                "fact": "A claim directly supported by cited evidence.",
                "inference": "A conclusion derived from facts but not directly stated by a source.",
                "assumption": "An input accepted temporarily without sufficient evidence.",
                "unknown": "A material question that available evidence does not resolve.",
                "independent_source": "A source controlled by a materially different publisher or originator.",
            },
            subquestions=subquestions,
            source_hierarchy=(
                "Official records, statutes, filings, datasets, standards, and first-party technical documentation",
                "Authoritative institutions, regulators, courts, and peer-reviewed research",
                "High-quality secondary reporting used for discovery or corroboration",
                "Unattributed, synthetic, or agent-generated material: never evidence",
            ),
            information_flow_rules=(
                "Agents receive only the approved mission, assigned subquestion, and source standard.",
                "Agent prose is treated as untrusted until evidence is independently checked.",
                "Evidence is referenced by SHA-256 fingerprint to expose mutation or substitution.",
                "Major claims require at least two independent qualifying publishers unless a single canonical source is dispositive.",
                "Contradictory qualifying evidence forces PARTLY_CONFIRMED or CONTRADICTED status.",
            ),
            acceptance_criteria=(
                "Every major claim has direct qualifying evidence.",
                "Every major non-canonical claim has at least two independent qualifying publishers.",
                "Dates, figures, names, and causal assertions are checked explicitly.",
                "No invalid evidence record, dangling fingerprint, or duplicate evidence reference remains.",
                "Final synthesis includes only CONFIRMED or clearly bounded PARTLY_CONFIRMED claims.",
            ),
            risks=(
                "Source capture can be incomplete, stale, paywalled, or silently updated.",
                "Publisher independence can be overstated when outlets syndicate the same origin.",
                "A canonical source can still contain errors; material claims may require external corroboration.",
                "Hashing protects evidence-record integrity, not the truth of the underlying source.",
                "Automated verification cannot replace expert judgment for high-stakes conclusions.",
            ),
            created_at=datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        )


class Verifier:
    """Fail-closed verifier for evidence packages."""

    QUALIFYING_TIERS = {EvidenceTier.PRIMARY, EvidenceTier.AUTHORITATIVE}

    @classmethod
    def audit(cls, claims: Iterable[Claim], evidence: Iterable[Evidence]) -> VerificationReport:
        evidence_list = list(evidence)
        claim_list = list(claims)
        package_errors: list[str] = []
        evidence_by_fp: dict[str, Evidence] = {}

        for item in evidence_list:
            errors = item.validate()
            if errors:
                package_errors.extend(f"evidence {item.fingerprint[:12]}: {err}" for err in errors)
                continue
            if item.fingerprint in evidence_by_fp:
                package_errors.append(f"duplicate evidence record: {item.fingerprint}")
                continue
            evidence_by_fp[item.fingerprint] = item

        audits: list[ClaimAudit] = []
        for claim in claim_list:
            reasons = claim.validate()
            accepted: list[Evidence] = []

            for fingerprint in claim.evidence_fingerprints:
                item = evidence_by_fp.get(fingerprint)
                if item is None:
                    reasons.append(f"dangling or invalid evidence fingerprint: {fingerprint}")
                else:
                    accepted.append(item)

            qualifying = [item for item in accepted if item.tier in cls.QUALIFYING_TIERS]
            publishers = {item.publisher.strip().casefold() for item in qualifying}

            if not qualifying:
                verdict = ClaimVerdict.UNVERIFIED
                confidence = 0.0
                reasons.append("no primary or authoritative evidence")
            elif claim.major and len(publishers) < 2:
                verdict = ClaimVerdict.PARTLY_CONFIRMED
                confidence = min(claim.asserted_confidence, 0.69)
                reasons.append("major claim lacks two independent qualifying publishers")
            else:
                verdict = ClaimVerdict.CONFIRMED
                evidence_strength = min(1.0, 0.55 + 0.15 * len(publishers))
                confidence = min(claim.asserted_confidence, evidence_strength)

            if reasons and verdict is ClaimVerdict.CONFIRMED:
                verdict = ClaimVerdict.PARTLY_CONFIRMED
                confidence = min(confidence, 0.69)

            audits.append(
                ClaimAudit(
                    claim_id=claim.claim_id,
                    verdict=verdict,
                    confidence=round(confidence, 2),
                    reasons=tuple(reasons),
                    accepted_evidence=tuple(item.fingerprint for item in accepted),
                )
            )

        accepted_package = (
            not package_errors
            and bool(audits)
            and all(
                audit.verdict in {ClaimVerdict.CONFIRMED, ClaimVerdict.PARTLY_CONFIRMED}
                for audit in audits
            )
            and all(
                (not claim.major) or audit.verdict is ClaimVerdict.CONFIRMED
                for claim, audit in zip(claim_list, audits)
            )
        )
        return VerificationReport(
            accepted=accepted_package,
            claim_audits=tuple(audits),
            package_errors=tuple(package_errors),
        )
