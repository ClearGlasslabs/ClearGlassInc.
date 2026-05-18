class ModelRouter:

    def __init__(self):
        self.routes = {
            "low": "economy-model",
            "medium": "standard-model",
            "high": "premium-governed-model"
        }

    def select_model(self, classification: str):
        return self.routes.get(classification, "standard-model")


if __name__ == "__main__":
    router = ModelRouter()
    print(router.select_model("high"))
