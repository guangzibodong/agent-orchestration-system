# MAWO Server Deployment Checklist

This checklist is the shortest safe path for deploying MAWO to a server today.
For deeper operations, backup, rollback, and incident notes, see
[OPERATIONS.md](OPERATIONS.md).

Repository:
[https://github.com/guangzibodong/agent-orchestration-system](https://github.com/guangzibodong/agent-orchestration-system)

## 1. Pick The Runtime Mode

Recommended first server deployment:

```text
MAWO_STATE_BACKEND=file
MAWO_QUEUE_BACKEND=in_process
MAWO_API_REPLICA_COUNT=1
```

Use this when one API process is enough and you want the fastest controlled
deployment. Runtime data is stored in `.mawo` or the `mawo_state` Docker volume.

Postgres worker deployment:

```text
MAWO_STATE_BACKEND=postgres
MAWO_QUEUE_BACKEND=postgres
MAWO_API_REPLICA_COUNT=2
```

Use this when you want queued jobs persisted in Postgres and executed by one or
more `worker:postgres` processes. In this mode, run the Compose
`postgres-worker` profile.

## 2. Server Prerequisites

- Git is installed on the server.
- Docker and Docker Compose are installed.
- Ports `3000` and `4000` are available, or mapped behind a reverse proxy.
- The API is protected by firewall, VPN, IP allowlist, reverse proxy auth, or a
  private network. Do not expose the API naked to the public internet.
- The target repositories live under one or more dedicated root directories.
- You have a long random operator token for `MAWO_API_TOKEN`.
- You have a strong `POSTGRES_PASSWORD`.
- You know the public API origin for `NEXT_PUBLIC_API_URL`.

## 3. Clone Or Update

Fresh server:

```bash
git clone https://github.com/guangzibodong/agent-orchestration-system.git mawo
cd mawo
```

Existing server checkout:

```bash
cd mawo
git fetch origin
git checkout main
git pull --ff-only origin main
```

## 4. Configure `.env`

```bash
cp .env.example .env
```

Set at minimum:

```text
NODE_ENV=production
API_HOST=0.0.0.0
API_PORT=4000
MAWO_STATE_BACKEND=file
MAWO_QUEUE_BACKEND=in_process
MAWO_MAX_CONCURRENT_JOBS=1
MAWO_API_REPLICA_COUNT=1
MAWO_API_TOKEN=<long-random-operator-token>
MAWO_VIEWER_API_TOKEN=<optional-read-only-token>
NEXT_PUBLIC_API_URL=https://<your-api-host-or-reverse-proxy>
MAWO_ALLOWED_REPOSITORY_ROOTS=/srv/repos
POSTGRES_PASSWORD=<strong-postgres-password>
```

Windows repository roots can use semicolon-separated absolute paths:

```text
MAWO_ALLOWED_REPOSITORY_ROOTS=C:\work\repos;D:\client-repos
```

Optional real CLI agent templates:

```text
MAWO_CODEX_COMMAND_TEMPLATE=codex run --prompt-file {promptFile}
MAWO_CODEX_AUTH_PROBE_COMMAND=codex auth status
MAWO_CLAUDE_COMMAND_TEMPLATE=claude -p @{promptFile}
MAWO_CLAUDE_AUTH_PROBE_COMMAND=claude --version
MAWO_CURSOR_COMMAND_TEMPLATE=cursor-agent {promptFile}
MAWO_CURSOR_AUTH_PROBE_COMMAND=cursor-agent --version
```

Leave these empty if the first deployment only uses shell tasks and the demo
agent.

## 5. Start With Docker Compose

Validate Compose config:

```bash
docker compose config
```

Start the default single-server stack:

```bash
docker compose up --build -d
docker compose ps
```

For Postgres queue mode:

```bash
docker compose --profile postgres-worker up --build -d
docker compose ps
```

The `mawo-migrate` service is expected to run once and exit successfully after
`npm run db:migrate:deploy`. The API waits for this migration service before it
starts.

## 6. Verify Health And Readiness

Public health:

```bash
curl -fsS http://127.0.0.1:4000/health
```

Protected readiness:

```bash
curl -fsS \
  -H "Authorization: Bearer $MAWO_API_TOKEN" \
  http://127.0.0.1:4000/readiness
```

Agent health:

```bash
curl -fsS \
  -H "Authorization: Bearer $MAWO_API_TOKEN" \
  http://127.0.0.1:4000/agents/health
```

Web:

```bash
curl -fsS http://127.0.0.1:3000
```

Readiness must report no production blockers before traffic is cut over.

## 7. Run Release Verification

Run the full product gate from the Windows/dev verification machine or an
equivalent staging host with Node.js, npm, Git, browser dependencies, and
PowerShell available:

```powershell
$env:PATH = "$((Get-Location).Path)\.tools\git\cmd;$((Get-Location).Path)\.tools\node;$env:PATH"
npm.cmd run env
npm.cmd run db:validate
npm.cmd run db:migrate:deploy
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run build
npm.cmd run smoke:ui
npm.cmd run smoke:api
npm.cmd run smoke:api:requirements
npm.cmd run smoke:backup:restore
npm.cmd run smoke:readiness:production
```

If the deployment uses Postgres state or Postgres queue:

```powershell
npm.cmd run smoke:api:postgres
npm.cmd run launch:gate:postgres
```

If the deployment stays file-backed and single-replica:

```powershell
npm.cmd run launch:gate:local
```

Latest generated evidence is saved under `output/launch-readiness/`.

On a Docker-only Linux server, the minimum server-side verification is:

```bash
docker compose ps
curl -fsS http://127.0.0.1:4000/health
curl -fsS -H "Authorization: Bearer $MAWO_API_TOKEN" http://127.0.0.1:4000/readiness
curl -fsS http://127.0.0.1:3000
```

## 8. Smoke A Real Requirement

In the web console:

1. Open the Requirement Delivery Console.
2. Create a New Requirement against a git repo under
   `MAWO_ALLOWED_REPOSITORY_ROOTS`.
3. Confirm repository safety shows branch, HEAD, clean state, allowed root, and
   the no-auto-merge contract.
4. Run one shell task and one required quality gate.
5. Confirm report evidence and manual `git apply` command are visible only
   after required gates pass.
6. Confirm viewer mode can read evidence but cannot enqueue, retry, review, or
   cancel.

## 9. Backup Before Traffic

File-backed Docker volume backup example:

```bash
mkdir -p .backups
docker run --rm \
  -v mawo_mawo_state:/data:ro \
  -v "$(pwd)/.backups:/backup" \
  alpine sh -c 'tar -czf /backup/mawo-state-$(date +%Y%m%d-%H%M%S).tgz -C /data .'
```

If your Compose project name is not `mawo`, check the actual volume name:

```bash
docker volume ls | grep mawo_state
```

Postgres deployments also need database backups according to the hosting
environment's normal backup policy.

## 10. Rollback

Fast rollback:

```bash
docker compose down
git checkout <previous-good-commit>
docker compose up --build -d
docker compose ps
```

If runtime data changed during the bad release, restore the matching `.mawo` or
Docker volume backup before restarting the API.

Do not run `docker compose down -v` unless you intend to delete runtime data.

## 11. Launch Boundaries

Accepted first-launch limits:

- no automatic PR creation;
- no automatic main-branch merge;
- no automatic task decomposition;
- no full DAG editor;
- no cloud multi-tenant control plane;
- no enterprise SSO/RBAC;
- no cost management;
- no long-term memory.

The production promise is safety and evidence for human-reviewed coding-agent
delivery, not full autonomous software delivery.
