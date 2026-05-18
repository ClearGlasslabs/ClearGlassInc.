# RBAC Policy Graph

## Role Hierarchy

```text
Platform Admin
    ├── Governor
    ├── Engineer
    ├── Auditor
    └── Maker
```

## Permissions Matrix

| Role | Permissions |
|---|---|
| Platform Admin | Full platform control |
| Governor | Policy and compliance management |
| Engineer | Workflow and runtime deployment |
| Auditor | Read-only telemetry access |
| Maker | Low-code conversational design |

## Enforcement Principles

- Least privilege
- Explicit authorization
- Scoped runtime permissions
- Immutable audit trails
