from enum import Enum


class WorkflowState(Enum):
    RECEIVED = "received"
    POLICY_VALIDATED = "policy_validated"
    HUMAN_REVIEW = "human_review"
    APPROVED = "approved"
    REJECTED = "rejected"


class RegulatedApprovalWorkflow:

    def __init__(self):
        self.state = WorkflowState.RECEIVED

    def validate_policy(self):
        print("Running governance checks...")
        self.state = WorkflowState.POLICY_VALIDATED

    def escalate_to_human(self):
        print("Escalating to compliance reviewer...")
        self.state = WorkflowState.HUMAN_REVIEW

    def approve(self):
        print("Workflow approved")
        self.state = WorkflowState.APPROVED

    def reject(self):
        print("Workflow rejected")
        self.state = WorkflowState.REJECTED


if __name__ == "__main__":
    workflow = RegulatedApprovalWorkflow()

    workflow.validate_policy()
    workflow.escalate_to_human()
    workflow.approve()

    print(f"Final State: {workflow.state.value}")
