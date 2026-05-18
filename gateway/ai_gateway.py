from typing import Dict


class AIGateway:

    def __init__(self):
        self.providers = {
            "foundry": self._call_foundry
        }

    def route(self, provider: str, payload: Dict):
        if provider not in self.providers:
            raise ValueError(f"Unsupported provider: {provider}")

        return self.providers[provider](payload)

    def _call_foundry(self, payload: Dict):
        return {
            "provider": "azure_ai_foundry",
            "status": "success",
            "payload": payload
        }
