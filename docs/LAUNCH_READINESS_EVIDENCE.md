# MAWO Launch Readiness Evidence

Status as of 2026-06-06: not launch-ready yet, but the local file-backed P0 trust loop has fresh passing smoke evidence.

## Verified This Run

Commands run from the repository root on `main` at commit `c78f63e`.

| Check | Result | Evidence |
| --- | --- | --- |
| `npm.cmd run smoke:api` | Passed | Real temporary git repo registered, required gate failure blocked merge candidate with `409`, retry reset workflow, retry run reached `needs_review`, report artifact was readable, merge candidate was ready, manual apply updated the target repo, audit and cleanup checks passed. |
| `npm.cmd run smoke:api:requirements` | Passed | Viewer can read requirements and is blocked from writes, operator can create/confirm/enqueue a requirement, failed required gate synced requirement to `needs_rework`, requirement retry reset current evidence, retry enqueue produced `needs_review`, requirement report and merge candidate endpoints returned `200`. |
| `npm.cmd run smoke:backup:restore` | Passed | File-backed `.mawo` state was backed up, damaged/restored, API restarted, restored workflow/report/merge candidate/artifacts/readiness were readable. |

## Current Launch Decision

Current decision: `not-ready` until the target deployment environment is selected and its production readiness checks pass there.

The local file-backed runtime has passed the core P0 product proof:

1. Real repo path can be registered and safety-checked.
2. Required gate failure prevents a successful merge candidate.
3. Retry clears stale evidence and can produce passing current evidence.
4. Report and merge candidate are available only after passing gates.
5. Human apply is explicit and audited.
6. Backup/restore preserves review evidence after restart.

## Remaining Release Gates

- Run `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run test`, `npm.cmd run build`, and `npm.cmd run smoke:ui` fresh immediately before release tagging.
- Run `npm.cmd run smoke:api:postgres` if the launch target uses `MAWO_STATE_BACKEND=postgres` or `MAWO_QUEUE_BACKEND=postgres`. This requires `DATABASE_URL`, migrated schema, and a reachable Postgres instance.
- Check `GET /readiness` in the actual production configuration and confirm no blocker remains.
- Verify production secrets are not examples: `MAWO_API_TOKEN`, optional `MAWO_VIEWER_API_TOKEN`, `MAWO_ALLOWED_REPOSITORY_ROOTS`, and `POSTGRES_PASSWORD` when using Compose/Postgres.
- Keep the known limits in `docs/OPERATIONS.md#11-known-limits` attached to the launch notes.

## Known Limits Accepted For First Launch

- No user accounts, enterprise SSO/RBAC, or multi-tenant isolation.
- File-backed state plus in-process queue is single-API-replica only.
- Redis queue backend is reserved but not implemented.
- Production public exposure still needs a reverse proxy, TLS, and an auth boundary.
- Target repositories must be git repositories with a committed `HEAD`.
- Long-running task and gate commands should set explicit `timeoutMs`.
