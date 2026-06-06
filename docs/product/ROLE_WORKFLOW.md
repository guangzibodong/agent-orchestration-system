# Product-First Role Workflow

Date: 2026-06-06
Status: active working agreement

## 1. Operating Rule

No feature development starts without a requirement delivery ticket.

Every engineering task must map to:

- a target user;
- a real user problem;
- an expected workflow or screen;
- explicit acceptance criteria;
- a test plan;
- a named owner and write scope.

If one of those inputs is missing, the next action is product/design clarification, not coding.

## 2. Roles

| Role | Responsibility | Output |
| --- | --- | --- |
| Project Manager | Sequence work, manage dependencies, enforce gates, track delivery risk | Sprint board, role assignments, delivery status |
| Product Manager | Define problem, scope, non-goals, metrics, acceptance criteria | PRD, feature briefs, prioritization, decision log |
| User Representative | Challenge value, trust, usability, and buying reasons | User objections, trial criteria, proof requirements |
| UI/UX Designer | Convert requirements into journeys, IA, screens, states, and copy hierarchy | User journeys, information architecture, wireframes, UI acceptance |
| Tech Lead | Define architecture, contracts, risks, and integration plan | technical approach, data/API impact, task breakdown |
| Backend Engineer | Implement API, runner, persistence, queues, agent adapters | tested backend changes |
| Frontend Engineer | Implement console flows, states, errors, and review surfaces | tested UI changes |
| QA | Define and run success, failure, retry, persistence, and smoke tests | test plan, automation, verification evidence |
| Operations | Own env, deployment, backups, rollback, readiness, runbooks | operations docs, deployment checks |
| Lead Integrator | Merge outputs, resolve conflicts, run full verification | integrated branch, final evidence |

## 3. Stage Gates

| Stage | Entry | Exit |
| --- | --- | --- |
| 0. Problem Brief | A user problem is suspected | User, pain, current workaround, and value hypothesis are documented |
| 1. PRD / Feature Brief | Problem is worth exploring | Scope, non-goals, metrics, user flow, states, and acceptance are clear |
| 2. UI / UX Design | Feature behavior is defined | First screen, page flow, components, empty/error/loading states are defined |
| 3. Technical Plan | PRD and UI are stable enough | API/data changes, execution plan, risks, and tests are defined |
| 4. Development | Product, design, tech, and QA gates are complete | Code is implemented with targeted tests |
| 5. Integration | Slice is code-complete | Success, failure, retry, persistence, and smoke paths pass |
| 6. Release Decision | Verification evidence exists | Launch-ready or not-ready decision is recorded |
| 7. Retrospective | Slice is delivered or stopped | Learnings, missed assumptions, and next decisions are recorded |

## 4. Definition Of Ready

A slice is ready for engineering only when all items are true:

- Problem statement names the target customer and current pain.
- Scope and non-goals are explicit.
- User journey covers success and failure.
- UI surface or API-only behavior is specified.
- Acceptance criteria are testable.
- Required quality gates are known.
- Data/API/persistence impact is listed.
- Rollback or cleanup behavior is defined if execution creates artifacts.
- Test plan covers at least success path, failure path, retry path, and persistence when relevant.
- Owner and write scope are assigned.

## 5. Definition Of Done

A slice is done only when:

- Implementation matches the approved feature brief.
- Tests were added or updated before claiming completion.
- Targeted tests pass.
- `npm run test`, `npm run typecheck`, `npm run lint`, and `npm run build` pass unless the slice is docs-only.
- HTTP smoke runs when API behavior changes.
- UI smoke or screenshot check runs when user-facing UI changes.
- Docs are updated when behavior, env, setup, or positioning changes.
- Remaining risks are recorded in the decision log or follow-up backlog.

## 6. Change Control

New ideas are not automatically accepted mid-slice.

| Change type | Handling |
| --- | --- |
| Clarifies existing acceptance | Update feature brief and continue |
| Changes user flow or UI | Return to UI gate |
| Changes data model or API contract | Return to technical gate |
| Adds new customer segment | Return to PRD gate |
| Adds P1/P2 capability | Put in backlog unless it is required for current acceptance |
| Increases safety or blocks data loss | Escalate immediately and update scope |

## 7. Multi-Agent Collaboration Rules

When multiple agents work in parallel:

- Each agent gets a role, objective, and write scope.
- Agents should not edit the same files unless the Lead Integrator explicitly coordinates it.
- Explorer agents answer specific questions and do not edit.
- Worker agents edit only their assigned files.
- QA can run verification in parallel but must report commands and evidence.
- The Lead Integrator owns final review, conflict resolution, and full gates.

## 8. Daily Cadence

| Time | Action | Output |
| --- | --- | --- |
| Morning | Requirement gate | What can enter development today |
| Midday | Integration check | Conflicts, blockers, test failures |
| End of day | Demo or evidence review | Working behavior, failed assumptions, next gate |

This cadence exists to keep speed high without returning to "build by feeling".
