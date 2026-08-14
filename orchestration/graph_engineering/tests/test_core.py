import unittest

from orchestration.graph_engineering.core import (
    Claim,
    ClaimVerdict,
    Evidence,
    EvidenceTier,
    Planner,
    Verifier,
)


class PlannerTests(unittest.TestCase):
    def test_plan_contains_verifier_dependency(self):
        plan = Planner.create("Determine the strongest evidence-backed service for Ontario SMEs.")
        self.assertEqual(plan.subquestions[-1]["role"], "independent-verifier")
        self.assertIn("Q4", plan.subquestions[-1]["depends_on"])

    def test_short_mission_fails_closed(self):
        with self.assertRaises(ValueError):
            Planner.create("too short")


class EvidenceTests(unittest.TestCase):
    def test_fingerprint_is_stable(self):
        item = Evidence(
            source_title="Official Dataset",
            publisher="Example Regulator",
            publication_date="2026-08-14",
            url="https://example.org/data",
            supporting_passage="This authoritative record contains a sufficiently long supporting passage.",
            tier=EvidenceTier.PRIMARY,
        )
        self.assertEqual(item.fingerprint, item.fingerprint)
        self.assertEqual(len(item.fingerprint), 64)

    def test_http_source_rejected(self):
        item = Evidence(
            source_title="Weak transport",
            publisher="Example",
            publication_date="2026-08-14",
            url="http://example.org/data",
            supporting_passage="This supporting passage is long enough to pass the length gate.",
            tier=EvidenceTier.PRIMARY,
        )
        self.assertIn("source URL must be absolute HTTPS", item.validate())


class VerifierTests(unittest.TestCase):
    @staticmethod
    def evidence(publisher: str, path: str) -> Evidence:
        return Evidence(
            source_title=f"Source from {publisher}",
            publisher=publisher,
            publication_date="2026-08-14",
            url=f"https://example.org/{path}",
            supporting_passage="Direct source material that supports the claim with enough context for validation.",
            tier=EvidenceTier.AUTHORITATIVE,
        )

    def test_major_claim_requires_two_publishers(self):
        source = self.evidence("Regulator A", "a")
        claim = Claim(
            claim_id="C1",
            text="A material claim requiring independent corroboration.",
            evidence_fingerprints=(source.fingerprint,),
            asserted_confidence=0.95,
        )
        report = Verifier.audit([claim], [source])
        self.assertFalse(report.accepted)
        self.assertEqual(report.claim_audits[0].verdict, ClaimVerdict.PARTLY_CONFIRMED)

    def test_two_independent_publishers_confirm_major_claim(self):
        first = self.evidence("Regulator A", "a")
        second = self.evidence("Standards Body B", "b")
        claim = Claim(
            claim_id="C2",
            text="A material claim with independent authoritative corroboration.",
            evidence_fingerprints=(first.fingerprint, second.fingerprint),
            asserted_confidence=0.9,
        )
        report = Verifier.audit([claim], [first, second])
        self.assertTrue(report.accepted)
        self.assertEqual(report.claim_audits[0].verdict, ClaimVerdict.CONFIRMED)

    def test_dangling_fingerprint_fails(self):
        claim = Claim(
            claim_id="C3",
            text="A claim referencing evidence that is not present.",
            evidence_fingerprints=("0" * 64,),
            asserted_confidence=0.8,
        )
        report = Verifier.audit([claim], [])
        self.assertFalse(report.accepted)
        self.assertEqual(report.claim_audits[0].verdict, ClaimVerdict.UNVERIFIED)


if __name__ == "__main__":
    unittest.main()
