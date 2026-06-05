# MAWO Operations Runbook

This runbook is for the fastest safe launch of the MAWO multi-agent workflow
orchestrator. It covers the current verified runtime: Node.js API + Next.js web
app, with workflow state and artifacts persisted on local disk under `.mawo`.
Postgres and Redis are available through Docker Compose, but the current app
path does not require them for workflow execution.

## 1. Runtime Summary

- Web UI: Next.js, default `http://127.0.0.1:3000`
- API: Fastify, default `http://127.0.0.1:4000`
- Health endpoint: `GET /health`
- Readiness endpoint: `GET /readiness` for protected production checks.
- Workflow state: `.mawo/state/workflows.json`
- Job history: `.mawo/state/jobs.json`
- Repository registry: `.mawo/state/repositories.json`
- Audit events: `.mawo/state/audit-events.json`
- Workflow artifacts: `.mawo/artifacts/<workflowId>/`
- Local logs, if redirected by operator scripts: `.logs/`
- Optional infrastructure: Postgres `localhost:5432`, Redis `localhost:6379`

Current launch limitation: the application stores workflow state in files, not
Postgres/Redis. Treat `.mawo` as production data and back it up before deploys
or rollback operations.

## 2. Environment Variables

Copy the example and edit it for the target host:

```powershell
Copy-Item .env.example .env
notepad .env
```

Required for normal local operation:

- `API_HOST`: API bind host. Use `127.0.0.1` for local-only access. Use
  `0.0.0.0` on a server only when a firewall or reverse proxy controls access.
- `API_PORT`: API port. Default `4000`.
- `MAWO_API_TOKEN`: bearer token for all API routes except `GET /health`.
  Set a long random value before shared or production use.
- `NEXT_PUBLIC_API_URL`: browser-visible API URL. For local use:
  `http://127.0.0.1:4000`. For server use, set the public or reverse-proxied
  API origin.
- `NEXT_PUBLIC_REPOSITORY_PATH`: optional repository path prefilled in the web
  console.
- `MAWO_ALLOWED_REPOSITORY_ROOTS`: optional semicolon- or newline-separated
  absolute root paths. When set, repository registration and repository
  workflows outside these roots are rejected.
- `MAWO_CODEX_COMMAND_TEMPLATE`, `MAWO_CLAUDE_COMMAND_TEMPLATE`,
  `MAWO_CURSOR_COMMAND_TEMPLATE`: optional real CLI agent command templates.
  Leave empty to expose only the demo/fake agent.
- `MAWO_CODEX_AUTH_PROBE_COMMAND`, `MAWO_CLAUDE_AUTH_PROBE_COMMAND`,
  `MAWO_CURSOR_AUTH_PROBE_COMMAND`: optional lightweight commands used by
  `GET /agents/health` to confirm CLI auth/session readiness without starting a
  real workflow task.

Reserved or optional:

- `DATABASE_URL`: currently used only by Prisma helpers and future database
  work; workflow runtime still uses `.mawo`.
- `REDIS_URL`: reserved for future queue/runtime work.

Agent template placeholders:

- `{promptFile}`
- `{workspace}`
- `{goal}`

Example:

```powershell
$env:MAWO_CODEX_COMMAND_TEMPLATE = "codex run --prompt-file {promptFile}"
$env:MAWO_CODEX_AUTH_PROBE_COMMAND = "codex auth status"
```

## 3. Local Startup

From the repository root:

```powershell
$root = (Get-Location).Path
$env:PATH = "$root\.tools\node;$root\.tools\git\cmd;$env:PATH"
.\.tools\node\npm.cmd run env
.\.tools\node\npm.cmd install
.\.tools\node\npm.cmd run dev
```

Open:

- Web: `http://127.0.0.1:3000`
- API health: `http://127.0.0.1:4000/health`
- API readiness: `http://127.0.0.1:4000/readiness`
- Agent health: `http://127.0.0.1:4000/agents/health`

PowerShell health check:

```powershell
Invoke-RestMethod http://127.0.0.1:4000/health
Invoke-RestMethod http://127.0.0.1:4000/readiness
Invoke-RestMethod http://127.0.0.1:4000/agents
Invoke-RestMethod http://127.0.0.1:4000/agents/health
```

Expected health response:

```json
{
  "ok": true,
  "service": "mawo-api"
}
```

Expected agent health includes the built-in fake agent and any configured CLI
agents. The endpoint returns only the parsed command name, never the full command
template. Real agents can be `healthy`, `auth_unchecked`, `auth_failed`, or
`missing_command`:

```json
[
  {
    "id": "fake-agent",
    "label": "Fake CLI Agent",
    "configured": true,
    "healthy": true,
    "status": "healthy"
  }
]
```

Expected readiness response includes deployability checks for `.mawo/state`,
`.mawo/artifacts`, Git CLI availability, agent health, token protection, and
active queue pressure. In production, treat `ok=false` as a deployment blocker
until each degraded check is resolved:

```json
{
  "ok": true,
  "service": "mawo-api",
  "protectedByToken": true,
  "activeJobs": 0,
  "checks": [
    { "id": "state_store", "ok": true, "status": "ready" },
    { "id": "artifact_store", "ok": true, "status": "ready" },
    { "id": "git_cli", "ok": true, "status": "ready" },
    { "id": "agents", "ok": true, "status": "ready" }
  ]
}
```

## 4. Docker Compose Stack

Docker Compose can run the API, web console, Postgres, Redis, and a named
runtime state volume for `.mawo`:

```powershell
Copy-Item .env.example .env
docker compose up -d
docker compose ps
```

The default container ports are:

- Web: `http://127.0.0.1:3000`
- API: `http://127.0.0.1:4000`
- Postgres: `localhost:5432`
- Redis: `localhost:6379`

Stop the stack:

```powershell
docker compose down
```

Do not use `docker compose down -v` in an environment with data you care about;
it deletes the named `.mawo`, Postgres, and Redis volumes.

## 5. Server Startup

Use a dedicated checkout or release directory on the server. The app should run
behind a firewall or reverse proxy. `MAWO_API_TOKEN` protects direct API calls,
but it is not a replacement for TLS, network controls, or operator identity.

One-time setup:

```powershell
$root = (Get-Location).Path
$env:PATH = "$root\.tools\node;$root\.tools\git\cmd;$env:PATH"
Copy-Item .env.example .env
notepad .env
.\.tools\node\npm.cmd install
.\.tools\node\npm.cmd run build
```

For server access, set at minimum:

```text
API_HOST="0.0.0.0"
API_PORT="4000"
MAWO_API_TOKEN="<long-random-token>"
NEXT_PUBLIC_API_URL="https://<your-api-host-or-proxy>"
MAWO_ALLOWED_REPOSITORY_ROOTS="C:\work\repos;D:\client-repos"
```

Start API and web in separate supervised processes. Minimal PowerShell example:

```powershell
New-Item -ItemType Directory -Force .logs
$env:NODE_ENV = "production"

Start-Process -WindowStyle Hidden -FilePath ".\.tools\node\npm.cmd" `
  -ArgumentList "run start -w @mawo/api" `
  -RedirectStandardOutput ".logs\api.out.log" `
  -RedirectStandardError ".logs\api.err.log"

Start-Process -WindowStyle Hidden -FilePath ".\.tools\node\npm.cmd" `
  -ArgumentList "run start -w @mawo/web" `
  -RedirectStandardOutput ".logs\web.out.log" `
  -RedirectStandardError ".logs\web.err.log"
```

Recommended production supervision:

- Windows: NSSM, Windows Service wrapper, Task Scheduler, or the hosting
  platform's process supervisor.
- Linux: systemd or the hosting platform's process supervisor.

Ensure the process working directory is the repository root; `.mawo` is created
relative to the current working directory.

## 6. Health Checks

API:

```powershell
Invoke-RestMethod http://127.0.0.1:4000/health
Invoke-RestMethod http://127.0.0.1:4000/jobs
Invoke-RestMethod "http://127.0.0.1:4000/jobs?status=canceled&workflowId=<workflowId>&limit=20"
Invoke-RestMethod "http://127.0.0.1:4000/jobs?status=canceled&repositoryId=<repositoryId>&limit=20"
Invoke-RestMethod http://127.0.0.1:4000/jobs/<jobId>/timeline
Invoke-RestMethod http://127.0.0.1:4000/workflows
Invoke-RestMethod "http://127.0.0.1:4000/workflows?status=needs_review&limit=20"
Invoke-RestMethod "http://127.0.0.1:4000/workflows?status=needs_review&repositoryId=<repositoryId>&limit=20"
Invoke-RestMethod http://127.0.0.1:4000/repositories
Invoke-RestMethod -Method Delete http://127.0.0.1:4000/repositories/<repositoryId>
Invoke-RestMethod http://127.0.0.1:4000/audit-events
Invoke-RestMethod "http://127.0.0.1:4000/audit-events?type=workflow.created&repositoryId=<repositoryId>&limit=20"
Invoke-RestMethod "http://127.0.0.1:4000/audit-events?type=repository.updated&repositoryId=<repositoryId>&actor=operator&limit=20"
```

Web:

```powershell
Invoke-WebRequest http://127.0.0.1:3000 -UseBasicParsing
```

Optional infrastructure:

```powershell
docker compose ps
docker exec mawo-postgres pg_isready -U mawo -d mawo
docker exec mawo-redis redis-cli ping
```

Operational smoke test:

```powershell
$workflow = Invoke-RestMethod -Method Post http://127.0.0.1:4000/workflows/demo
Invoke-RestMethod -Method Post "http://127.0.0.1:4000/workflows/$($workflow.id)/enqueue"
Invoke-RestMethod http://127.0.0.1:4000/jobs
Invoke-RestMethod "http://127.0.0.1:4000/jobs?workflowId=$($workflow.id)&limit=5"
```

Completed or aborted worktree workflow cleanup:

```powershell
$preview = Invoke-RestMethod "http://127.0.0.1:4000/workflows/<workflow-id>/workspaces"
$preview.workspaces | Format-Table taskId, exists, cleanupAllowed, branch, path
Invoke-RestMethod -Method Post "http://127.0.0.1:4000/workflows/<workflow-id>/workspaces/cleanup"
```

Cleanup is intentionally rejected for `needs_review` and `failed` workflows so
operators can inspect patches and failure state before removing worktrees.
Use `GET /workflows/:id/workspaces` first to see whether cleanup is allowed,
how many tracked worktrees still exist on disk, and which task branch/path will
be removed by the cleanup call.

Retry is the exception for failed, gate-failed, or aborted workflows: before the
workflow is reset to `ready`, the runner removes any tracked task worktrees and
their temporary branches. This prevents stale failed-attempt worktrees from
being orphaned when the next attempt creates fresh isolated workspaces.

Read a persisted workflow artifact without shelling into the host:

```powershell
$report = Invoke-RestMethod "http://127.0.0.1:4000/workflows/<workflow-id>/report"
$artifact = Invoke-RestMethod "http://127.0.0.1:4000/workflows/<workflow-id>/artifact?path=$([uri]::EscapeDataString($report.reportArtifactPath))"
$artifact.content
```

The artifact endpoint only serves files under `.mawo/artifacts/<workflow-id>/`
and caps returned text at 64 KiB by default.

Merge candidates are intentionally blocked until workflow work is review-ready.
If a task produced a patch but the workflow is still `ready`, `running`,
`failed`, `gate_failed`, or `aborted`, `GET /workflows/:id/merge-candidate`
returns `409 merge_candidate_not_ready`. This keeps failed quality gates from
being presented as safe-to-apply patches.

## 7. Logs and Data Locations

Runtime logs:

- API Fastify logs are written to stdout/stderr.
- Next.js logs are written to stdout/stderr.
- If started with the example above, logs are in `.logs/api.out.log`,
  `.logs/api.err.log`, `.logs/web.out.log`, and `.logs/web.err.log`.

Persistent workflow data:

- `.mawo/state/workflows.json`: workflow and review state.
- `.mawo/state/jobs.json`: background job history. Queued/running jobs found
  during API startup are marked failed because the in-process worker cannot be
  resumed after restart. If the matching workflow is still `running`, startup
  recovery marks it `aborted`, converts running tasks/gates to `canceled`, and
  records `interrupted=api_restart` metadata so operators can retry from a
  consistent state.
- `.mawo/state/repositories.json`: registered repositories and their default
  quality gates.
- `.mawo/state/audit-events.json`: append-only operator and runner trail for
  workflow creation, enqueue, retry, review, workspace cleanup, task/gate
  lifecycle, and job cancellation.
  Retry events include `previousStatus`, `cleanedCount`, `cleanedTaskIds`,
  `cleanedBranches`, and `cleanedPaths` so operators can confirm stale
  worktrees and temporary branches were removed before a new attempt.
- `.mawo/artifacts/`: task stdout/stderr, patches, reports, and merge
  candidates.
- Worktree paths may appear inside workflow artifacts and reports.

Git ignore already excludes `.mawo`, `.logs`, `.env`, `dist`, `.next`, and
`node_modules`.

## 8. Backup and Restore

Back up `.mawo` before each deploy, rollback, or manual data cleanup.

PowerShell backup:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force ".backups"
Compress-Archive -Path ".mawo" -DestinationPath ".backups\mawo-$stamp.zip"
```

PowerShell restore:

```powershell
Stop-Process -Name node -ErrorAction SilentlyContinue
Rename-Item ".mawo" ".mawo.restore-prep-$(Get-Date -Format yyyyMMdd-HHmmss)" -ErrorAction SilentlyContinue
Expand-Archive ".backups\mawo-YYYYMMDD-HHMMSS.zip" -DestinationPath "."
```

Linux backup:

```bash
mkdir -p .backups
tar -czf ".backups/mawo-$(date +%Y%m%d-%H%M%S).tgz" .mawo
```

Linux restore:

```bash
pkill -f "mawo|next|node" || true
mv .mawo ".mawo.restore-prep-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
tar -xzf .backups/mawo-YYYYMMDD-HHMMSS.tgz
```

Retention suggestion for first launch: keep every pre-deploy backup for 7 days,
then keep one daily backup for 30 days.

## 9. Rollback

Fast rollback steps:

1. Stop API and web processes.
2. Back up the current `.mawo` directory.
3. Check out or copy the previous known-good release.
4. Restore the matching `.mawo` backup if workflow state changed during the bad
   release.
5. Run `npm install` only if dependencies changed between releases.
6. Run `npm run build`.
7. Start API and web.
8. Verify `/health`, web homepage, `/workflows`, and one demo workflow enqueue.

If only frontend rendering is broken and API state is healthy, prefer rolling
back the web process first while keeping the API and `.mawo` untouched.

## 10. Security Notes

- Do not expose the API directly to the public internet without
  `MAWO_API_TOKEN`, TLS, VPN, IP allowlist, or reverse proxy access control.
- The API can execute repository workflow commands; treat users with API access
  as trusted operators.
- Keep `.env`, `.mawo`, `.logs`, and backups out of git and public file shares.
- Review CLI agent templates before enabling them on a shared server.
- Use least-privilege OS users for the service account. Avoid running the app as
  Administrator/root.
- Restrict repository paths that operators can submit. Prefer a dedicated parent
  directory for allowed repositories and set `MAWO_ALLOWED_REPOSITORY_ROOTS`.
- Backups can contain prompts, patches, stdout/stderr, repository paths, and
  secrets printed by commands. Store them accordingly.

## 11. Known Limits

- API token auth exists, but there are no user accounts, roles, or tenant
  isolation.
- CORS currently allows all origins.
- Workflow state is file-based under `.mawo`, so concurrent multi-host API
  replicas are not supported.
- The background worker is still in the API process. Job history is persisted,
  but queued/running jobs found after API restart are marked failed. Matching
  running workflows are recovered to `aborted` with interrupted task/gate
  metadata, then require operator retry.
- Postgres and Redis are present in Compose but are not the active workflow
  persistence path.
- API and web are containerized, but production public exposure still requires
  a reverse proxy, TLS, and an auth boundary.
- Repository workflows require the target repository to be a git repository with
  a committed `HEAD`.
- Long-running agent commands should set `timeoutMs` in workflow requests.

## 12. Pre-Launch Checklist

- [ ] `.env` exists on the target host and matches the intended API/web URLs.
- [ ] `MAWO_API_TOKEN` is set to a long random value and is not the example
      value.
- [ ] `MAWO_ALLOWED_REPOSITORY_ROOTS` is set to the smallest practical set of
      repository parent directories.
- [ ] `npm run env` passes on the host.
- [ ] `npm install` completed successfully.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test` passes.
- [ ] `npm run lint` passes or approved lint exceptions are documented.
- [ ] `npm run build` passes.
- [ ] `docker compose config` succeeds on the target host.
- [ ] API starts and `GET /health` returns `{ "ok": true }`.
- [ ] `GET /readiness` returns `ok=true`, reports token protection, and marks
      `state_store`, `artifact_store`, `git_cli`, and `agents` as ready.
- [ ] `GET /agents/health` returns the built-in fake agent as healthy and no
      configured production agent reports `missing_command` or `auth_failed`.
- [ ] Web starts and can reach the configured API URL from the browser.
- [ ] A demo workflow can be created and enqueued.
- [ ] A completed worktree workflow can be cleaned with
      `POST /workflows/:id/workspaces/cleanup`.
- [ ] `.mawo` backup was created and restore path was tested at least once.
- [ ] Logs are captured by `.logs`, service manager, or hosting provider.
- [ ] API access is protected by bearer token, firewall, VPN, reverse proxy
      auth, or IP allowlist.
- [ ] CLI agent templates are reviewed and only trusted operators can trigger
      workflows.
- [ ] Rollback release and matching `.mawo` backup are available.

## 13. Incident Quick Reference

API down:

```powershell
Get-Process node -ErrorAction SilentlyContinue
Get-Content .logs\api.err.log -Tail 80
Invoke-RestMethod http://127.0.0.1:4000/health
```

Web cannot reach API:

```powershell
Get-Content .env
Invoke-RestMethod http://127.0.0.1:4000/health
Invoke-WebRequest http://127.0.0.1:3000 -UseBasicParsing
```

Workflow state looks wrong:

```powershell
Get-Item .mawo\state\workflows.json
Get-ChildItem .mawo\artifacts
```

Disk pressure:

```powershell
Get-ChildItem .mawo -Recurse | Measure-Object -Property Length -Sum
Get-ChildItem .logs -Recurse | Measure-Object -Property Length -Sum
```
