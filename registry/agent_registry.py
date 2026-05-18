from dataclasses import dataclass
from typing import Dict


@dataclass
class Agent:
    name: str
    role: str
    classification: str


class AgentRegistry:

    def __init__(self):
        self.registry: Dict[str, Agent] = {}

    def register(self, agent: Agent):
        self.registry[agent.name] = agent

    def get(self, name: str):
        return self.registry.get(name)


if __name__ == "__main__":
    registry = AgentRegistry()

    registry.register(
        Agent(
            name="compliance-agent",
            role="governance",
            classification="regulated"
        )
    )

    print(registry.get("compliance-agent"))
