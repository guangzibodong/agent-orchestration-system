# MAWO Multi-Agent Workflow Orchestrator

Local-first workflow orchestration for coordinating coding agents across real
repositories. The current system runs workflows in isolated git worktrees,
captures logs and patches, applies quality gates, persists run state/artifacts,
and supports human review decisions.

## Toolchain

Portable tooling is installed inside the project:

- `.tools/node`: Node.js and npm
- `.tools/git`: Git for Windows

Set PATH before running commands in PowerShell:

```powershell
$root = (Get-Location).Path
$env:PATH = "$root\.tools\node;$root\.tools\git\cmd;$env:PATH"
```

## Common Commands

```powershell
.\.tools\node\npm.cmd install
.\.tools\node\npm.cmd run dev
.\.tools\node\npm.cmd run test
.\.tools\node\npm.cmd run smoke:api
.\.tools\node\npm.cmd run typecheck
.\.tools\node\npm.cmd run lint
.\.tools\node\npm.cmd run build
```

## Current Capabilities

- Fastify API with persistent workflow state under `.mawo/state/workflows.json`
- Persistent audit event log under `.mawo/state/audit-events.json`
- Artifact store under `.mawo/artifacts`
- In-memory background job queue for non-blocking workflow runs
- Workflow-level active job guard to prevent duplicate concurrent runs
- Queue job cancellation through `POST /jobs/:id/cancel`
- Shell task runner
- Configurable CLI agent runner
- Git worktree isolation per task
- Real repository workflow creation through `POST /workflows/repository`
- Quality gates with stdout/stderr capture
- Report aggregation with patch, git status, and artifact paths
- Failed workflow retry through `POST /workflows/:id/retry`
- Human review through `POST /workflows/:id/review`
- Merge candidate generation through `GET /workflows/:id/merge-candidate`
- Next.js run console with demo workflows, repository workflows, queue polling,
  retry, approve/reject controls, and merge candidate display

## API Highlights

```text
GET  /health
GET  /agents
GET  /workflows
GET  /audit-events
GET  /audit-events?workflowId=<id>
POST /workflows/demo
POST /workflows/worktree-demo
POST /workflows/agent-demo
POST /workflows/repository
GET  /workflows/:id
POST /workflows/:id/enqueue
POST /workflows/:id/run
POST /workflows/:id/retry
POST /workflows/:id/review
GET  /workflows/:id/report
GET  /workflows/:id/merge-candidate
GET  /jobs
GET  /jobs/:id
POST /jobs/:id/cancel
```

Repository workflow request:

```json
{
  "goal": "Run a real repository workflow",
  "repositoryPath": "C:/path/to/repo",
  "tasks": [
    {
      "id": "repository-task",
      "title": "Repository task",
      "agent": "shell",
      "command": "npm test",
      "timeoutMs": 900000
    }
  ],
  "qualityGates": [
    {
      "id": "quality-gate",
      "title": "Quality gate",
      "command": "npm run lint",
      "timeoutMs": 300000
    }
  ]
}
```

The repository must be a git repository with a committed `HEAD`.
`timeoutMs` is optional, but recommended for every task and quality gate so
agent or test processes cannot hang indefinitely.

Retry failed or gate-failed workflows without rebuilding the original request:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:4000/workflows/<id>/retry
Invoke-RestMethod -Method Post http://127.0.0.1:4000/workflows/<id>/enqueue
```

Duplicate enqueue requests for a workflow that already has a queued or running
job return `409 workflow_already_running` with the existing active job in the
response body.

Retry resets task and gate statuses to `waiting`, clears stale results,
workspaces, diffs, and review decisions, then returns the workflow to `ready`.

Cancel queued or running jobs:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:4000/jobs/<jobId>/cancel
```

Queued jobs are prevented from starting. Running jobs receive an abort signal,
the underlying shell/CLI process is terminated, and the workflow moves to
`aborted` with the active task marked `canceled`.

Audit events:

```powershell
Invoke-RestMethod http://127.0.0.1:4000/audit-events
Invoke-RestMethod "http://127.0.0.1:4000/audit-events?workflowId=<id>"
```

The file-backed audit log records operator actions such as workflow creation,
enqueue, retry, review, and job cancellation.

Merge candidates aggregate passed task patches into:

- `.mawo/artifacts/<workflowId>/merge-candidate.patch`
- `.mawo/artifacts/<workflowId>/merge-candidate.json`

The response includes an `applyCommand` such as:

```powershell
git -C "C:/path/to/repo" apply "C:/path/to/merge-candidate.patch"
```

## CLI Agent Configuration

The fake demo agent is always available. Real CLI agents are registered by
setting command templates:

```powershell
$env:MAWO_CODEX_COMMAND_TEMPLATE = "codex run --prompt-file {promptFile}"
$env:MAWO_CLAUDE_COMMAND_TEMPLATE = "claude -p @{promptFile}"
$env:MAWO_CURSOR_COMMAND_TEMPLATE = "cursor-agent {promptFile}"
```

Supported placeholders:

- `{promptFile}`
- `{workspace}`
- `{goal}`

The prompt file is written outside the git worktree so internal orchestration
files do not pollute captured patches.

## Environment

Copy `.env.example` if you want local overrides. Docker/Postgres/Redis are
planned production dependencies, but the current verified path does not require
Docker Desktop.

## Deployment and Operations

For local startup, server startup, health checks, logs, `.mawo` backups,
rollback, security notes, and the pre-launch checklist, see
[`docs/OPERATIONS.md`](docs/OPERATIONS.md).
