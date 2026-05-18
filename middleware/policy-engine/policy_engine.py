from dataclasses import dataclass
from typing import Dict, Any


@dataclass
class PolicyResult:
    allowed: bool
    reason: str
    classification: str


class PolicyEngine:

    def __init__(self):
        self.blocked_keywords = [
            "credential",
            "social security",
            "private key",
            "bypass policy"
        ]

    def classify(self, payload: Dict[str, Any]) -> str:
        text = payload.get("prompt", "").lower()

        if "financial" in text or "legal" in text:
            return "regulated"

        if "customer" in text or "employee" in text:
            return "sensitive"

        return "standard"

    def evaluate(self, payload: Dict[str, Any]) -> PolicyResult:
        prompt = payload.get("prompt", "").lower()

        for keyword in self.blocked_keywords:
            if keyword in prompt:
                return PolicyResult(
                    allowed=False,
                    reason=f"Blocked keyword detected: {keyword}",
                    classification="critical"
                )

        classification = self.classify(payload)

        return PolicyResult(
            allowed=True,
            reason="Policy evaluation passed",
            classification=classification
        )


if __name__ == "__main__":
    engine = PolicyEngine()

    sample_payload = {
        "prompt": "Summarize financial compliance workflow"
    }

    result = engine.evaluate(sample_payload)

    print(result)
