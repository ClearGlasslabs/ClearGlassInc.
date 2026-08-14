from __future__ import annotations

import argparse
import json
from pathlib import Path

try:
    from .core import Claim, Evidence, EvidenceTier, Planner, Verifier
except ImportError:
    from core import Claim, Evidence, EvidenceTier, Planner, Verifier


def _load_package(path: Path) -> tuple[list[Claim], list[Evidence]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    evidence = [
        Evidence(
            source_title=item["source_title"],
            publisher=item["publisher"],
            publication_date=item["publication_date"],
            url=item["url"],
            supporting_passage=item["supporting_passage"],
            tier=EvidenceTier(item["tier"]),
            retrieved_at=item.get("retrieved_at", ""),
        )
        for item in data.get("evidence", [])
    ]
    claims = [
        Claim(
            claim_id=item["claim_id"],
            text=item["text"],
            evidence_fingerprints=tuple(item.get("evidence_fingerprints", [])),
            major=bool(item.get("major", True)),
            asserted_confidence=float(item.get("asserted_confidence", 0.0)),
        )
        for item in data.get("claims", [])
    ]
    return claims, evidence


def main() -> int:
    parser = argparse.ArgumentParser(description="ClearGlass Graph Engineering orchestrator")
    subparsers = parser.add_subparsers(dest="command", required=True)

    plan = subparsers.add_parser("plan", help="Create a research plan; performs no research")
    plan.add_argument("--mission", required=True)

    verify = subparsers.add_parser("verify", help="Fail-closed audit of an evidence package")
    verify.add_argument("--package", type=Path, required=True)

    args = parser.parse_args()
    if args.command == "plan":
        print(json.dumps(Planner.create(args.mission).to_dict(), indent=2, sort_keys=True))
        return 0

    claims, evidence = _load_package(args.package)
    report = Verifier.audit(claims, evidence)
    print(json.dumps(report.to_dict(), indent=2, sort_keys=True))
    return 0 if report.accepted else 2


if __name__ == "__main__":
    raise SystemExit(main())
