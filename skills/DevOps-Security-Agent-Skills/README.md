# DevOps & Security Agent Skills

## Production AI Agent Skills Framework

A modular, governed AI agent skills library designed for DevOps, cybersecurity, cloud infrastructure, AI engineering, compliance, SRE, platform engineering, incident response, threat intelligence, and automation.

## Mission

Provide reusable engineering knowledge units that transform AI assistants into evidence-driven operational partners while preserving human oversight, security controls, and auditability.

## Design Principles

- Security by Design
- Evidence-Based Decisions
- Auditability
- Least Privilege
- Human Oversight
- Reproducibility
- Provenance Tracking
- Continuous Validation

## Repository Architecture

```text
skills/
├── devops/
├── security/
├── cloud/
├── sre/
├── infrastructure/
├── ai-engineering/
├── compliance/
├── networking/
├── kubernetes/
├── containers/
├── observability/
└── automation/

templates/
playbooks/
runbooks/
workflows/
docs/
examples/
tools/
policies/
```

## Skill Specification

Every skill follows this contract:

```yaml
name:
purpose:
when_to_use:
inputs:
outputs:
success_criteria:
risk_considerations:
security_controls:
validation_checklist:
example_prompts:
automation_opportunities:
references:
```

## Initial Skill Roadmap

Target: 150+ validated skills.

### DevOps (40+)

Coverage:
- CI/CD engineering
- GitOps workflows
- Release engineering
- Deployment validation
- Infrastructure as Code
- Terraform
- Ansible
- Jenkins
- GitHub Actions
- Azure DevOps
- Platform engineering

### Security (35+)

Coverage:
- Threat modeling
- Vulnerability assessment
- Secure configuration
- IAM reviews
- Zero Trust
- Secrets management
- Security auditing
- Incident response
- SIEM operations
- Detection engineering
- AI security

### Infrastructure (65+)

Coverage:
- AWS
- Azure
- GCP
- Cloudflare
- Kubernetes
- Linux administration
- Networking
- DNS
- Storage
- Disaster recovery
- High availability
- Capacity planning

### AI Engineering (20+)

Coverage:
- LLMOps
- RAG pipelines
- Vector databases
- Prompt engineering
- Agent design
- Model evaluation
- AI governance
- AI security
- Inference infrastructure

### Compliance (20+)

Coverage:
- ISO 27001
- SOC 2
- GDPR
- NIST CSF
- PCI DSS
- HIPAA
- AI governance
- Risk registers
- Audit evidence
- Policy as code

## Governance Model

All skills require:

1. Version control
2. Owner assignment
3. Security review
4. Validation evidence
5. Change history
6. Deprecation process
7. Human approval for high-risk automation

## Quality Gates

Before publication:

- Technical accuracy review completed
- Security controls documented
- References verified
- Examples tested
- Automation impact assessed
- Failure modes documented

## Metrics Dashboard

Track:

- Skill adoption
- Validation success rate
- Automation coverage
- Incident reduction
- Documentation freshness
- Security review status
- Repository health

## Status

Framework foundation created. Expand skill modules incrementally with controlled reviews and automated validation.
