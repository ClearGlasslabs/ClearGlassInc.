# ClearGlass Shared Auto-Heal Engine

This public, version-pinned bundle is the reusable engine for repository-local GitHub Actions self-healing. Each consuming repository keeps its own `.github/auto-heal/` policy, history, learned signatures, and flaky-failure data. The shared engine provides only the bootstrap implementation and baseline policy.

The controller classifies failed/cancelled/timed-out jobs, retries bounded transient infrastructure failures, records an audit trail, and escalates ambiguous, security-sensitive, dependency, test, build, or deployment failures instead of weakening controls. It never force-pushes, edits secrets, disables tests/security scans, or auto-merges remediation PRs.
