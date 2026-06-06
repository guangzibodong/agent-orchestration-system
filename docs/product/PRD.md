# MAWO Product Requirements Document

Date: 2026-06-06
Status: v0.2 product-first baseline
Owner roles: Product Manager, Project Manager, User Representative, UI/UX, Tech Lead

## 1. Product Positioning

MAWO is a local-first safety and acceptance console for coding agents.

The product should not lead with "multi-agent orchestration". Buyers already have Codex, Claude Code, Cursor, git worktrees, CI, and scripts. The valuable promise is narrower and stronger:

> Turn AI coding agent output in a real local repository into an isolated, verifiable, retryable, auditable, merge-ready patch.

The user is not buying orchestration for its own sake. They are buying confidence that an agent change did not pollute the main repository, that quality gates really ran, and that the final report tells them whether the patch is safe to review or apply.

## 2. Target Customers

P0 launch customers:

| Segment | User | Pain | Launch focus |
| --- | --- | --- | --- |
| A | Independent developers using coding agents daily | Agent output is hard to verify and often needs manual cleanup | Yes |
| B | 2-10 person AI-native engineering teams | Team leads need repeatable review evidence before accepting AI changes | Yes |
| C | Delivery studios and automation teams | They must hand off AI-generated changes with logs, diffs, gates, and audit records | Yes |

Deferred customers:

| Segment | Reason deferred |
| --- | --- |
| Large enterprise platform teams | Requires org governance, SSO, policy, tenancy, and procurement proof |
| Non-technical app builders | The product still assumes git, tests, commands, and code review |
| Generic agent automation users | The highest-value wedge is software delivery, not Zapier-style automation |

## 3. Core Problem

When users run AI coding agents against real repositories, agents may produce useful code, but users still have to manually answer:

- Did it run in an isolated workspace?
- What files changed?
- Which command produced the change?
- Did the right tests or gates run?
- Did a failure get hidden behind a positive summary?
- Can I safely review or apply this patch?
- Can I retry without stale diffs or stale review decisions leaking into the new result?

This manual verification is slow, inconsistent, and risky. It makes AI agent output feel like a promising draft instead of a trustworthy engineering artifact.

## 4. Jobs To Be Done

Primary JTBD:

> When I ask a coding agent to modify my real repository, I want the change isolated, tested, summarized, and packaged as a reviewable patch, so I can decide quickly whether to apply it without trusting the agent blindly.

Secondary JTBD:

- When a gate fails, I want the system to block merge-ready conclusions and show exactly what failed.
- When I retry, I want the old worktree, diff, gates, and review decision cleaned up or clearly superseded.
- When I hand off work to a teammate or client, I want a report that contains changed files, command output, gate results, artifacts, risks, and next steps.
- When a CLI agent is unavailable, I want the system to say so clearly instead of pretending it can run.

## 5. Product Principles

1. Trust before automation.
   The product must prove what happened before it suggests what to do.

2. Human approval by default.
   MAWO creates merge candidates and clear `git apply` commands. It does not silently modify the main branch.

3. Real repository first.
   Demos are useful, but the product value is proven only against a real local git repository.

4. Failure must be first-class.
   Gate failures, dirty repositories, missing agent credentials, timeouts, and cancelled runs are normal states with clear next actions.

5. Requirements before execution.
   Development work starts from a requirement delivery ticket with user value, constraints, acceptance criteria, and UI behavior.

## 6. MVP Scope

### P0 Must Have

1. Requirement delivery ticket
   - Captures repository, goal, acceptance criteria, constraints, non-goals, risk level, expected gates, and context paths.
   - Has lifecycle states: `draft`, `needs_clarification`, `plan_review`, `ready_to_run`, `running`, `needs_review`, `delivered`, `needs_rework`, `archived`.

2. Real local repository workflow
   - Validates repository path, git status, HEAD, allowed root, and dirty-state risk.
   - Shows clearly whether the main repository will be modified. Default contract: no automatic main-branch modification.

3. Manual task input
   - Supports 1-5 explicit tasks.
   - Each task has title, objective, agent or command, timeout, dependencies, and task-level acceptance.
   - Automatic task decomposition is deferred until the manual loop is trusted.

4. Shell plus configurable CLI agent
   - Shell must be reliable.
   - At least one CLI agent command template can be configured.
   - Unconfigured agents must show `unavailable` with setup guidance.

5. Isolated worktree execution
   - Each task runs in its own git worktree.
   - Captures stdout, stderr, exit code, duration, git status, changed files, and patch.
   - Internal orchestration files must not pollute captured patches.

6. Quality gates
   - Supports test, lint, typecheck, build, or custom gate commands.
   - Gate output includes stdout, stderr, exit code, timeout, duration, and pass/fail status.
   - Required gate failure blocks merge-ready conclusions.

7. Review report
   - Must answer: what changed, what ran, what failed, what artifacts exist, what risks remain, and what should happen next.
   - Users must not need raw JSON to decide whether to continue.

8. Merge candidate
   - Generated only from passed work.
   - Includes patch path, changed files, risk summary, and explicit `git apply` command.
   - Does not auto-merge the main branch.

9. Retry and cancellation
   - Cancel queued or running jobs.
   - Retry failed or cancelled workflows without stale worktree, patch, gate, or review state contaminating the new result.

10. Persistence
   - Workflow, report, audit, artifact metadata, and review decisions remain readable after API/Web restart.

### P1 Should Have

- Workflow and job history.
- Artifact browser.
- Worktree cleanup policy and UI.
- Agent health checks and configuration diagnostics.
- Viewer/operator access split.
- Postgres-backed state and queue for long-running deployment.
- A first UI redesign around requirement delivery tickets.

### P2 Defer

- Automatic task decomposition.
- Full DAG editor.
- Multi-agent competition and scoring.
- Automatic PR creation.
- Automatic conflict resolution.
- Cloud-hosted multi-tenant control plane.
- SSO, org permissions, policy governance.
- Cost/token management.
- Long-term vector memory.

## 7. Success Metrics

| Metric | MVP target |
| --- | ---: |
| First successful real repo run | New user completes within 20 minutes |
| Report decision clarity | 80% of pilot users can decide next step from report alone |
| Manual copy/paste reduction | 70% fewer manual copy steps versus ad hoc CLI workflow |
| Gate coverage | Every merge-ready workflow has at least one required gate |
| Retry trust | Retry produces no stale diff, gate, or review decision |
| Pilot value signal | 3 of 5 target users want to keep using it after a real repo trial |

## 8. Acceptance Criteria For Launch Candidate

The product cannot be called launch-ready unless all P0 criteria pass:

- A user can register or select a real local git repository.
- The UI shows branch, clean/dirty status, allowed-root status, and main-branch safety contract.
- A user can create a requirement delivery ticket with at least one task and one gate.
- At least two tasks can run; at least one produces a code diff.
- Each task runs in an isolated worktree.
- Required gate failure blocks a successful merge candidate.
- Retry clears stale execution results.
- Report shows changed files, patch, stdout/stderr artifacts, gate results, risks, and next action.
- Merge candidate includes a patch and `git apply` command.
- API/Web restart does not lose workflow/report/audit data.
- The UI does not present demo runs as the primary path.

## 9. Discovery Assumptions

High-risk assumptions to validate first:

| Assumption | Type | Risk | Validation |
| --- | --- | --- | --- |
| Users will trust a local safety console enough to run it on real repos | Desirability | High | 5 pilot trials with real repositories |
| Report clarity is more valuable than full auto-planning | Desirability | High | Ask users to decide merge/retry from reports only |
| Dirty repo and gate-failure handling affect trust | Usability | High | Usability test failure paths |
| Manual tasks are acceptable for MVP | Desirability | Medium | Compare setup time versus manual CLI workflow |
| CLI agent template setup is understandable | Usability | Medium | First-run onboarding test |
| File/Postgres persistence is sufficient for pilots | Feasibility | Medium | Restart and recovery smoke tests |

## 10. Recommended First Product Slice

The next implementation slice should not start until its feature brief is approved:

> Real repo success -> gate failure -> retry success -> merge candidate.

This slice proves the core value loop:

1. Select a real repository.
2. Create a requirement ticket with one or two concrete tasks.
3. Run tasks in isolated worktrees.
4. Force a gate failure and confirm no merge-ready conclusion is shown.
5. Retry and pass.
6. Generate a merge candidate with evidence and a safe next action.
