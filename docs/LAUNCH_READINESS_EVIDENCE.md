# MAWO Launch Readiness Evidence

This document summarizes the latest committed launch-readiness record. The
machine-generated source of truth is the newest Markdown/JSON pair under
`output/launch-readiness/`, created by `npm run launch:gate:local` or
`npm run launch:gate:postgres`.

## Latest Full Gate

Latest generated evidence before the deployment-document refresh:

- Markdown: `output/launch-readiness/2026-06-08T04-32-15-270Z.md`
- JSON: `output/launch-readiness/2026-06-08T04-32-15-270Z.json`
- Commit: `9cc5f1b Add new requirement visual evidence`
- Local decision: `passed`
- Production decision: `ready`
- Dirty files in evidence: none
- External blockers: none

The gate passed the frozen P0 launch proof:

1. Real repository success path.
2. Required gate failure blocks merge-ready conclusions.
3. Retry clears stale evidence and reaches passing current evidence.
4. Merge candidate is generated only after passing gates.
5. Review evidence shows changed files, gate result, artifacts, and manual
   `git apply`.
6. Viewer mode can read evidence but cannot perform write actions.
7. Backup/restore smoke preserves review evidence after restart.
8. Desktop and mobile UI smoke screenshots have no horizontal overflow.

## Checks Passed

- `npm.cmd run env`
- `git diff --check`
- `npm.cmd run db:generate`
- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run test`
- `npm.cmd run build`
- `npm.cmd run smoke:ui`
- `npm.cmd run smoke:api`
- `npm.cmd run smoke:api:requirements`
- `npm.cmd run smoke:backup:restore`
- `npm.cmd run smoke:readiness:production`
- `npm.cmd run db:validate`
- `npm.cmd run db:migrate:deploy`
- `npm.cmd run smoke:api:postgres`

## Release Rule

Before tagging or cutting traffic on the actual server, refresh evidence from
the exact commit being deployed:

```powershell
npm.cmd run launch:gate:postgres
```

For a file-backed single-server launch that intentionally does not use Postgres
state or Postgres queue, run:

```powershell
npm.cmd run launch:gate:local
```

The API exposes the latest generated JSON at:

```text
GET /launch/evidence/latest
```

The Requirement Delivery Console uses that endpoint as a read-only launch
health signal and marks evidence stale when commit, branch, or dirty files no
longer match the current checkout.

## Remaining Server-Specific Checks

These are not product blockers, but they must be completed on the target server:

- production `.env` uses non-example `MAWO_API_TOKEN`;
- optional `MAWO_VIEWER_API_TOKEN` is tested as read-only;
- `MAWO_ALLOWED_REPOSITORY_ROOTS` points only at intended repository roots;
- `POSTGRES_PASSWORD` is strong when Compose/Postgres is used;
- `NEXT_PUBLIC_API_URL` matches the public or reverse-proxied API origin;
- API is behind TLS, VPN, IP allowlist, reverse proxy auth, or a private
  network;
- `GET /readiness` on the server reports no production blockers;
- `.mawo` or the `mawo_state` Docker volume is backed up before traffic cutover;
- rollback commit and matching runtime backup are known.

## Known Limits Accepted For First Launch

- No user accounts, enterprise SSO/RBAC, or multi-tenant isolation.
- File-backed state plus in-process queue is single-API-replica only.
- Postgres state plus Postgres queue requires one or more `worker:postgres`
  processes.
- Redis queue backend is reserved but not implemented.
- Production public exposure still needs a reverse proxy, TLS, and an external
  auth/network boundary.
- Target repositories must be git repositories with a committed `HEAD`.
- Long-running task and gate commands should set explicit `timeoutMs`.
- MAWO creates merge candidates and explicit manual `git apply` commands; it
  does not auto-merge main by default.
