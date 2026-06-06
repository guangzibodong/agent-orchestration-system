# MAWO Requirements Freeze

Date: 2026-06-06
Status: requirements frozen, UI-ready, not launch-ready

This document records the cross-role decision meeting. It supersedes ad hoc implementation momentum until the UI stage is complete and accepted.

## 1. Meeting Result

The requirement is frozen as:

> MAWO is a local AI coding agent safety and acceptance console for real repositories.

The customer-visible promise is:

> Turn coding agent output into an isolated, quality-gated, retryable, auditable, human-applied merge candidate patch.

The product must not lead with broad "multi-agent orchestration" for the first launch. That language can remain as a long-term category, but the launch wedge is trust, evidence, and safe review of real repository changes.

## 2. Frozen P0 Scope

P0 is fixed to the following capabilities:

1. Requirement Delivery Ticket as the primary product object.
2. Real local git repository selection and safety status.
3. Manual task input, 1-5 tasks.
4. Shell execution plus configurable CLI agent support.
5. One isolated git worktree per task.
6. Required quality gates that block merge-ready conclusions when they fail.
7. Report with changed files, stdout/stderr artifacts, gate results, risks, and next action.
8. Merge candidate with patch path and explicit `git apply` command.
9. Retry and cancel without stale result confusion.
10. Persistence for ticket, workflow, report, audit, artifact, job, and review evidence.
11. Viewer/operator access boundary.
12. UI first screen centered on requirements, decisions, and review evidence.

## 3. Frozen Non-Goals

These are explicitly out of this round:

- automatic task decomposition;
- full DAG editor;
- multi-agent competition or scoring;
- automatic PR creation;
- automatic conflict resolution;
- cloud multi-tenant control plane;
- enterprise SSO/RBAC/governance;
- token/cost management;
- long-term vector memory;
- demo runs as the main user path;
- automatic main-branch modification as the default path.

## 4. Product Object Decision

`RequirementDeliveryTicket` is a new first-class product object.

`WorkflowRun` remains the execution layer.

Relationship:

```text
RequirementDeliveryTicket 1 -> N WorkflowRun
RequirementDeliveryTicket.currentWorkflowRunId -> current execution attempt
WorkflowRun.requirementId -> owning requirement ticket
```

This preserves the existing execution engine and prevents retry/report/review evidence from being mixed into one ambiguous workflow object.

## 5. Frozen Ticket Fields

The ticket must carry at least:

- `id`;
- `title`;
- `repositoryId` or `repositoryPath`;
- `goal`;
- `acceptanceCriteria`;
- `constraints`;
- `nonGoals`;
- `riskLevel`;
- `contextPaths`;
- `tasks`;
- `qualityGates`;
- `status`;
- `currentWorkflowRunId`;
- `createdAt`;
- `updatedAt`.

Launch can add owner, priority, createdBy, budget, and richer value-report fields later, but the UI should leave space for them.

## 6. Status Mapping

| Requirement status | Execution mapping | UI meaning |
| --- | --- | --- |
| `draft` | no workflow, incomplete ticket | requirement is not ready |
| `needs_clarification` | no runnable workflow | missing goal, acceptance, repo, task, or gate |
| `plan_review` | tasks and gates exist, not confirmed | user must confirm the plan |
| `ready_to_run` | workflow `ready`, no active job | can enqueue execution |
| `running` | job `queued/running` or workflow `running` | execution is active |
| `needs_review` | workflow `needs_review` | gates passed, evidence can be reviewed |
| `delivered` | workflow `completed` and review approved | accepted result, not auto-merged |
| `needs_rework` | workflow `failed/gate_failed/aborted` or review rejected | failed, cancelled, blocked, or rejected |
| `archived` | ticket archived | no longer active |

`gate_failed` maps to `needs_rework` with reason `failed_required_gate`.

## 7. Safety Decisions

These decisions are frozen for P0:

- A dirty repository blocks mutating requirement runs by default.
- Dirty repository apply is blocked.
- The first launch does not offer a normal-path override for dirty repository execution.
- Repository safety must show branch, HEAD, clean/dirty state, allowed-root status, and no-auto-merge contract.
- Required gates default to `required: true`.
- Optional gates may fail without blocking only after the schema explicitly marks them optional.
- The main UI must not present `apply merge candidate` as the default action.
- The main path shows patch path and `git apply`; any direct apply endpoint is operator-only, advanced, and visually de-emphasized.
- Missing CLI agent configuration is a preflight failure for tasks that require that agent.
- Shell remains available only when the task explicitly uses shell.

## 8. Minimum API Contract

Preferred API surface:

```text
POST /requirements
GET /requirements
GET /requirements/:id
PATCH /requirements/:id
POST /requirements/:id/confirm-plan
POST /requirements/:id/enqueue
POST /requirements/:id/retry
GET /requirements/:id/report
GET /requirements/:id/merge-candidate
```

The first implementation may delegate internally to existing workflow endpoints, but frontend should consume requirement-oriented names and state.

Minimum schema additions:

- `requirementDeliveryTicketSchema`;
- `createRequirementDeliveryTicketRequestSchema`;
- `updateRequirementDeliveryTicketRequestSchema`;
- `requirementStatusSchema`;
- `requirementRunLinkSchema`;
- `repositorySafetySchema`;
- `decisionQueueItemSchema`.

## 9. Old Code Reuse Decision

The previous code is not wasted. It becomes the execution and evidence layer.

| Existing capability | Reuse path |
| --- | --- |
| `WorkflowRun` schema | execution attempt under a requirement ticket |
| repository registry | repository selection and safety card |
| repository workflow endpoint | execution creation under ticket flow |
| `LocalRunner` | task/gate/report execution core |
| `GitWorktreeManager` | worktree isolation and patch capture |
| `ShellAdapter` / `CliAgentAdapter` | agent execution layer |
| file/Postgres stores | persistence and job history |
| artifact store | stdout, stderr, patch, report evidence |
| report endpoint | review and value-report source |
| merge candidate endpoint | patch evidence and `git apply` command |
| retry/cancel/job queue | execution control |
| audit events | review and operations evidence |
| agent health/readiness | setup and safety diagnostics |
| viewer/operator auth | review access boundary |

What gets demoted:

- `Shell Run`, `Worktree Run`, `Agent Run` demo buttons;
- raw repository command form as first-screen primary UI;
- operations summary as the main panel;
- long stdout/stderr/patch blocks in the first screen;
- workflow/job IDs as headline product language.

## 10. UI Stage Scope

UI stage starts now, with scope limited to:

1. Requirement Delivery Console first screen.
2. New Requirement flow.
3. Requirement detail shell.
4. Repository Safety Card.
5. Requirement Queue.
6. Requirement Stage Stepper.
7. Decision Queue.
8. Gate Result Panel.
9. Review Evidence / Merge Candidate Panel.
10. Artifact Drawer.
11. Viewer Mode Banner.
12. Legacy Run Console demotion path.

UI stage is not allowed to introduce new P1/P2 product promises.

## 11. UI Acceptance

UI stage is accepted only when:

- first screen primary CTA is `New Requirement`;
- demo actions are visibly secondary;
- repository safety is visible before execution;
- failed required gate disables merge-ready conclusion;
- retry makes current versus stale evidence clear;
- report/review screen allows decision without raw JSON;
- viewer mode blocks write actions;
- desktop and mobile screenshots have no text overflow or incoherent overlap;
- old Run Console capabilities remain reachable as secondary execution/ops/debug support.

## 12. Staffing Plan

Because the current platform supports four active subagents at a time, we will operate in waves.

Core team:

| Role | Responsibility | Write boundary |
| --- | --- | --- |
| Lead Integrator | final decisions, conflict resolution, full verification | whole repo, integration only |
| Product PM | scope freeze, feature briefs, decision log | `docs/product/**` |
| UX/UI | first-screen design, states, components, copy hierarchy | `docs/product/**`, later `apps/web/src/app/globals.css` |
| Tech Lead | status mapping, API contracts, execution boundaries | docs plus cross-layer review |
| Backend Contract | ticket schema, requirement API, repo safety, gate semantics | `packages/shared/**`, `apps/api/**` |
| Runner Safety | preflight, dirty repo, agent unavailable, retry evidence | `apps/api/src/runner/**`, tests |
| Frontend Architecture | split legacy console, data hook, new console shell | `apps/web/src/**` |
| Frontend Integration | requirement UI, safety card, review evidence | `apps/web/src/**` |
| QA | tests, HTTP smoke, UI smoke, acceptance matrix | `*.test.ts`, `scripts/**`, Playwright |
| Ops/Release | readiness, env, backup/restore, launch checklist | `docs/OPERATIONS.md`, `.env.example`, deployment docs |

Recommended active wave size:

- 4 subagents plus Lead Integrator.
- Wave 1: Product PM, UX/UI, Tech Lead, QA.
- Wave 2: Backend Contract, Runner Safety, Frontend Architecture, Frontend Integration.
- Wave 3: QA, Ops/Release, Frontend polish, Backend hardening.

## 13. First Implementation Slice

The first slice after UI design is:

> real repo success -> gate failure -> retry success -> merge candidate.

It must prove:

1. Create a requirement ticket for a real repo.
2. Run at least two tasks, one producing a diff.
3. Fail a required gate and block merge-ready output.
4. Retry with clean current evidence.
5. Pass gates and generate a merge candidate.
6. Show report evidence and `git apply`, without auto-merging.
7. Keep evidence readable after restart.

## 14. Launch Decision

Current status:

- Requirements: frozen.
- Automation: old recurring heartbeat was deleted.
- UI stage: allowed to start.
- Engineering: only allowed after UI/API contract acceptance for the frozen slice.
- Launch readiness: not ready.

Launch-ready requires:

- all P0 acceptance checks pass;
- `npm run test`;
- `npm run typecheck`;
- `npm run lint`;
- `npm run build`;
- `npm run smoke:api`;
- `npm run smoke:api:postgres` when using Postgres launch mode;
- UI smoke screenshots for desktop and mobile;
- readiness shows no production blocker;
- backup/restore evidence exists;
- known limits are documented.
