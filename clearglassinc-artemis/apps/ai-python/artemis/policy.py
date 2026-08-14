"""Policy Decision Point client. Wraps OPA/Cedar in production; local stub here."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


@dataclass
class PolicyDecision:
    allow: bool
    reason: str
    decision_id: str


_CLEARANCE = {"UNCL": 0, "CONF": 1, "SECRET": 2, "TS": 3}


def policy_check(
    *,
    actor_id: str,
    action: str,
    actor: Mapping[str, object],
    resource: Mapping[str, object],
    context: Mapping[str, object] | None = None,
) -> PolicyDecision:
    context = context or {}
    actor_clearance = actor.get("clearance")
    resource_classification = resource.get("classification")
    if not isinstance(actor_clearance, str) or actor_clearance not in _CLEARANCE:
        return PolicyDecision(False, "invalid actor clearance", f"pdp-{actor_id}-{action}")
    if not isinstance(resource_classification, str) or resource_classification not in _CLEARANCE:
        return PolicyDecision(False, "invalid resource classification", f"pdp-{actor_id}-{action}")

    actor_rank = _CLEARANCE[actor_clearance]
    res_rank = _CLEARANCE[resource_classification]
    if actor_rank < res_rank:
        return PolicyDecision(False, "insufficient clearance", f"pdp-{actor_id}-{action}")

    raw_actor_scope = actor.get("coalition_scope", [])
    raw_resource_scope = resource.get("coalition_scope", [])
    if not isinstance(raw_actor_scope, list) or not all(isinstance(value, str) for value in raw_actor_scope):
        return PolicyDecision(False, "invalid actor coalition scope", f"pdp-{actor_id}-{action}")
    if not isinstance(raw_resource_scope, list) or not all(isinstance(value, str) for value in raw_resource_scope):
        return PolicyDecision(False, "invalid resource coalition scope", f"pdp-{actor_id}-{action}")
    actor_scope = set(raw_actor_scope)
    res_scope = set(raw_resource_scope)
    if res_scope and not (actor_scope & res_scope):
        return PolicyDecision(False, "coalition boundary violation", f"pdp-{actor_id}-{action}")

    if action == "action.execute":
        if not context.get("human_approval_token"):
            return PolicyDecision(False, "missing human approval token", f"pdp-{actor_id}-{action}")
        confidence = context.get("confidence")
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
            return PolicyDecision(False, "invalid confidence", f"pdp-{actor_id}-{action}")
        if not 0.0 <= confidence <= 1.0:
            return PolicyDecision(False, "invalid confidence", f"pdp-{actor_id}-{action}")
        if confidence < 0.8:
            return PolicyDecision(False, "confidence below threshold", f"pdp-{actor_id}-{action}")

    return PolicyDecision(True, "ok", f"pdp-{actor_id}-{action}")
