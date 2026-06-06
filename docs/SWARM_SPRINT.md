# MAWO Product-First Sprint Board

Started: 2026-06-06
Status: active working board

This board supersedes the old implementation-first 24-hour sprint. The product
is now driven by requirements, UI design, and acceptance evidence before code.

## Active Principle

> No user value, no requirement brief, no UI/API behavior, no acceptance
> criteria, no engineering work.

The current product wedge is not "multi-agent orchestration" as a broad
category. The launch wedge is:

> A local coding-agent safety and acceptance console that turns real repository
> changes into isolated, gated, auditable, merge-ready patches.

## Current Role Assignments

| Role | Responsibility | Current Objective |
| --- | --- | --- |
| Project Manager | Delivery flow, dependencies, gate discipline | Keep slices from entering development before ready |
| Product Manager | PRD, scope, non-goals, metrics | Keep P0 focused on real repo trust loop |
| User Representative | Buyer objections and trial proof | Challenge value and require real repo evidence |
| UI/UX Designer | Journey, IA, screens, states | Move console from run-first to requirement-first |
| Tech Lead | Architecture and testable plan | Translate approved briefs into bounded engineering slices |
| Backend | API, runner, queue, persistence, adapters | Implement only approved backend slices |
| Frontend | Console flows and states | Implement only approved UI slices |
| QA | Test plan and verification evidence | Cover success, failure, retry, restart, and smoke |
| Operations | Env, deployment, readiness, rollback | Keep runbook and deployment safety current |
| Lead Integrator | Final integration and gates | Resolve conflicts and run full verification |

## Product Documents

| Document | Purpose |
| --- | --- |
| `docs/product/PRD.md` | Product positioning, target users, scope, metrics, launch acceptance |
| `docs/product/REQUIREMENTS_FREEZE.md` | Frozen P0 decisions, UI-stage entry, staffing plan, launch gate |
| `docs/product/ROLE_WORKFLOW.md` | Role responsibilities, stage gates, Definition of Ready/Done |
| `docs/product/USER_JOURNEYS.md` | Success, failure, retry, review, and unsafe-repo journeys |
| `docs/product/UI_INFORMATION_ARCHITECTURE.md` | First-screen IA, requirement detail pages, components, UI acceptance |
| `docs/product/FEATURE_BRIEF_TEMPLATE.md` | Template required before engineering slices |
| `docs/product/DECISION_LOG.md` | Product decisions and rationale |

## Requirements Freeze Decision

Requirements are frozen as of 2026-06-06. The next phase is UI, not feature
implementation. Engineering work is allowed only after the UI/API contract for
the frozen slice is accepted.

Frozen product object:

```text
RequirementDeliveryTicket 1 -> N WorkflowRun
WorkflowRun = execution evidence, not the product object
```

Frozen first implementation slice:

> Real repo success -> gate failure -> retry success -> merge candidate.

Old code remains valuable as the execution/evidence layer: runner, worktree,
gate, report, artifact, retry, cancel, audit, auth, and merge candidate all stay.

## Highest-Value Approved Candidate Slice

The next slice should be briefed before coding:

> Real repo success -> gate failure -> retry success -> merge candidate.

This proves the customer-visible trust loop:

1. A real repo is selected and safety-checked.
2. A requirement delivery ticket is created.
3. Tasks run in isolated worktrees.
4. A required gate fails and blocks merge-ready status.
5. Retry supersedes stale execution state.
6. A passing run generates a merge candidate with evidence and `git apply`.

## Definition Of Ready

- Target customer and problem are named.
- User flow covers success and failure.
- UI/API behavior is specified.
- Scope and non-goals are explicit.
- Acceptance criteria are testable.
- Test plan includes success, failure, retry, and persistence when relevant.
- Owner and write scope are assigned.

## Definition Of Done

- Implementation matches approved brief.
- Targeted tests pass.
- Full gates pass before claiming completion:
  - `npm run test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
- API changes include HTTP smoke evidence.
- UI changes include browser smoke or screenshot evidence.
- Docs and decision log are updated when behavior or positioning changes.

## Backlog Discipline

P0:

- Requirement delivery ticket model.
- Requirement-first console.
- Repository safety status on first screen.
- Gate failure and retry proof loop.
- Merge candidate evidence panel.

P1:

- Worktree cleanup UI.
- Artifact browser.
- Agent configuration diagnostics.
- Postgres queue hardening.
- Viewer/operator review workflow.

P2:

- Automatic task decomposition.
- Full DAG editor.
- Multi-agent competition.
- Automatic PR creation.
- Cloud multi-tenant control plane.
