# User Journeys

Date: 2026-06-06
Status: product-first baseline

## 1. Primary Personas

| Persona | Goal | Trust barrier |
| --- | --- | --- |
| Independent developer | Use agents for low-risk repo tasks without manual cleanup | "Will this pollute my repo or waste more time than CLI?" |
| AI-native team lead | Let teammates or agents produce changes with review evidence | "Can I tell whether this is safe to accept?" |
| Delivery lead | Hand off AI-generated work to clients with proof | "Can I show logs, gates, diffs, and decisions clearly?" |

## 2. Journey A: First Successful Real Repo Run

User intent:

> I want to run one small coding task in my real repo and get a patch I can review.

Flow:

1. Open console.
2. Select or register local repository.
3. See repository safety status: branch, clean/dirty, allowed root, HEAD, "main branch will not be modified".
4. Create requirement delivery ticket.
5. Enter goal, one task, expected quality gate, constraints, and non-goals.
6. Confirm the task plan.
7. Run isolated workflow.
8. Watch progress by stage: requirement, execution, gates, review.
9. Open report.
10. Review changed files, patch, stdout/stderr, gate result, risk summary, and next action.
11. Copy or run the displayed `git apply` command manually outside MAWO.

Acceptance:

- User can finish in under 20 minutes.
- User never has to inspect raw JSON.
- UI clearly states that MAWO did not auto-merge.

## 3. Journey B: Gate Failure Blocks Merge-Ready Result

User intent:

> I want to know when an agent result is unsafe, not receive a cheerful false success message.

Flow:

1. Run a task with a required gate.
2. Gate fails.
3. Console moves the workflow to a failure or needs-attention state.
4. Merge candidate action is disabled or unavailable.
5. Report explains failed command, exit code, artifact links, and next action.
6. User chooses retry, reject, or inspect worktree.

Acceptance:

- Required gate failure never produces a successful merge-ready conclusion.
- The failed command and output are visible.
- The next action is explicit.

## 4. Journey C: Retry Without Stale Results

User intent:

> I want to fix or rerun a failed workflow and trust that old artifacts are not being mixed into the new result.

Flow:

1. Open failed workflow.
2. Click retry.
3. System warns which stale execution outputs will be superseded or cleaned.
4. New job starts with a fresh execution identity.
5. Old worktree/result/review state is no longer treated as current.
6. New gate passes.
7. Report and merge candidate only reference current successful execution.

Acceptance:

- New execution has distinct job/run evidence.
- Stale patch/gate/review decision cannot be mistaken for current output.
- Audit records show retry action.

## 5. Journey D: Team Review And Handoff

User intent:

> I need to hand an AI-generated code change to another person and make the review self-contained.

Flow:

1. Open delivered requirement.
2. Share report or export report content.
3. Reviewer sees goal, tasks, changed files, gate results, risks, artifacts, and apply command.
4. Reviewer approves, rejects, or asks for rework.
5. Decision is recorded in audit history.

Acceptance:

- Reviewer can decide without asking "what did the agent actually do?"
- Report shows both successful and failed evidence.
- Audit events show who took the review action.

## 6. Journey E: Unsafe Repository State

User intent:

> I want the system to protect me if my repository is dirty or outside allowed roots.

Flow:

1. User selects a repository.
2. System checks git repo, HEAD, branch, dirty state, and allowed root.
3. If unsafe, the run path is blocked or requires an explicit high-friction override.
4. UI explains why and how to recover.

Acceptance:

- Dirty repo is never silently treated as safe.
- Allowed-root failure is clear.
- The next action points to clean repo, configure allowed root, or choose another repo.

## 7. Before / After

| Step | Without MAWO | With MAWO |
| --- | --- | --- |
| Isolate work | Manually create branch or worktree | One workflow creates task worktrees |
| Capture output | Copy terminal logs manually | stdout/stderr artifacts stored automatically |
| Inspect diff | Manually run git commands | changed files and patch shown in report |
| Run gates | Remember correct command | required gates run and are attached to result |
| Retry | Manually clean branches and rerun | retry supersedes stale execution state |
| Review | Trust agent summary or inspect everything | report gives evidence and next action |
| Apply | Manually assemble patch | merge candidate provides patch and `git apply` |
