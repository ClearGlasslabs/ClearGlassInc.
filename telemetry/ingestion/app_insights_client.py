import logging
from datetime import datetime


class TelemetryClient:

    def __init__(self):
        self.logger = logging.getLogger("clearglass.telemetry")

    def emit_event(self, event_name: str, payload: dict):
        event = {
            "timestamp": datetime.utcnow().isoformat(),
            "event": event_name,
            "payload": payload
        }

        self.logger.info(event)


if __name__ == "__main__":
    client = TelemetryClient()

    client.emit_event(
        "workflow.executed",
        {
            "workflow": "regulated_approval",
            "status": "success"
        }
    )
