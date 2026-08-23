# CLEARGLASS FACTCHECK AI

## Product Mission

Transform public claims into transparent, evidence-based assessments using retrieval, provenance tracking, confidence scoring, and explainable AI.

## Core Principle

Transparency Is Infrastructure.

Every assessment exposes:

- Claim
- Evidence
- Sources
- Reasoning
- Confidence
- Contradictions
- Limitations
- Verification status

## Platform Architecture

- Frontend: Next.js 15, React, TypeScript, Tailwind, Shadcn UI, Framer Motion, Recharts
- Backend: FastAPI, Python, PostgreSQL, Redis, Celery
- AI orchestration: OpenAI compatible models, Azure OpenAI, local LLM support, LangGraph, LangChain
- Retrieval: enterprise search connectors, public records, government sources, research archives
- Vector intelligence: PostgreSQL pgvector
- Deployment: Docker and GitHub Actions

## Intelligence Pipeline

Input → Claim Extraction → Evidence Retrieval → Source Ranking → Cross Validation → Explainable Verdict

## Verification Model

The system separates:

- Observation
- Verified Fact
- Estimate
- Inference
- Assumption
- Recommendation
- Unknown

## Verdict Categories

- Verified True
- Mostly True
- Partially True
- Misleading
- Unverified
- Contradicted
- False
- Insufficient Evidence

## Security and Governance

Controls include:

- RBAC
- Audit logging
- Input validation
- Rate limiting
- Content security policy
- Prompt injection defenses
- Provenance preservation
- Human review paths

## Product Status

Architecture specification added to the ClearGlassInc. product portfolio. Implementation follows staged engineering validation, testing, security review, and controlled deployment.
