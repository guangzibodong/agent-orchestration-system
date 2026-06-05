# MAWO 24-Hour Launch Sprint

Started: 2026-06-05

This file is the coordination board for the multi-role sprint. It keeps agent
ownership explicit so parallel work can move fast without overwriting each
other.

## Active Automation

- Automation id: `agent`
- Cadence: every 15 minutes
- Duration: 96 runs, about 24 hours
- Purpose: continue implementation, verification, and integration until the
  system is materially closer to launch.

## Role Assignments

| Role | Agent | Ownership | Current Objective |
| --- | --- | --- | --- |
| Backend | Kuhn | `apps/api/src/**`, API parts of `packages/shared/src/**` | Add job/workflow cancel support with tests |
| Frontend | Godel | `apps/web/src/**` logic | Add cancel action and clearer job state handling |
| UI | Ohm | `apps/web/src/app/globals.css` and display-only UI polish | Tighten responsive layout and overflow behavior |
| QA | Averroes | `scripts/**`, optional test files | Turn manual HTTP/UI smoke checks into repeatable scripts |
| Product | Rawls | `docs/**` only | Define fastest launch scope, acceptance criteria, risk tradeoffs |
| Operations | Meitner | `docs/**`, `.env.example`, light deploy config | Prepare launch/runbook checklist |
| Lead Integrator | Parent thread | Integration, conflict resolution, verification | Merge role outputs, run full gates, pick next gap |

## Launch-Critical Capability Backlog

1. Cancel queued/running jobs.
2. Durable audit events for create/run/retry/cancel/review.
3. Repeatable smoke scripts for real repo workflow paths.
4. Worktree cleanup and retention policy.
5. Repository registry with health/dirty-state checks.
6. Real CLI agent detection and command-template diagnostics.
7. Deployment/runbook with backup and rollback steps.
8. Review/merge candidate hardening and artifact browsing.

## Definition of Done for Each Slice

- Failing test or explicit verification exists before implementation.
- Targeted tests pass after implementation.
- Shared schema and API docs stay in sync when contracts change.
- UI states are verified for loading, success, failure, and disabled actions.
- Full gates run before reporting a slice complete:
  - `npm run test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
- Any API behavior change gets an HTTP smoke check.

## Integration Rules

- Do not revert other roles' changes.
- Prefer small, bounded patches over large rewrites.
- Keep API contracts explicit in `packages/shared`.
- Keep productionization ahead of decorative UI work.
- If conflicts appear, preserve tested behavior first, then improve ergonomics.

