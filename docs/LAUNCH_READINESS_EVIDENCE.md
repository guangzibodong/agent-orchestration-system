# MAWO Launch Readiness Evidence

Status as of 2026-06-07T16:54:54.409Z: the local file-backed P0 trust loop is launch-ready, with production release still blocked only by external Postgres verification that requires `DATABASE_URL`.

## Verified This Run

Latest generated evidence:

- Markdown: `output/launch-readiness/2026-06-07T16-54-54-409Z.md`
- JSON: `output/launch-readiness/2026-06-07T16-54-54-409Z.json`

Commands ran from the repository root on `main` at commit `67565b8`.

| Check | Result | Evidence |
| --- | --- | --- |
| `npm.cmd run smoke:ui` | Passed | Chromium UI smoke ran 31 tests, including the real API New Requirement journey: browser creates a requirement for a real temporary git repo, repository safety is visible, two isolated shell tasks produce reviewable diffs, a required gate fails and blocks merge-ready evidence, retry resets stale evidence, retry enqueue reaches `needs_review`, Review Evidence shows changed files, gate status, manual `git apply`, and no `Apply Candidate` action. |
| `npm.cmd run smoke:api` | Passed | Real temporary git repo registered, required gate failure blocked merge candidate with `409`, retry reset workflow, retry run reached `needs_review`, report artifact was readable, merge candidate was ready, manual apply updated the target repo, audit and cleanup checks passed. |
| `npm.cmd run smoke:api:requirements` | Passed | Viewer can read requirements and is blocked from writes, operator can create/confirm/enqueue a requirement, failed required gate synced requirement to `needs_rework`, requirement retry reset current evidence, retry enqueue produced `needs_review`, requirement report and merge candidate endpoints returned `200`. |
| `npm.cmd run smoke:backup:restore` | Passed | File-backed `.mawo` state was backed up, damaged/restored, API restarted, restored workflow/report/merge candidate/artifacts/readiness were readable. |
| `npm.cmd run smoke:readiness:production` | Passed | Starts the API in production mode with a strong token, restricted repository root, file state, in-process queue, and one API replica; verifies unauthenticated readiness is rejected and authenticated readiness reports no blockers without leaking command templates. |
| `npm.cmd run launch:gate:local` | Local passed, production blocked | Ran env, whitespace, typecheck, lint, test, build, UI smoke, API smoke, requirement API smoke, backup/restore smoke, and production readiness smoke. Postgres schema validation, migration deploy, and Postgres API smoke were recorded as external-blocked because `DATABASE_URL` is not configured. |

## Current Launch Decision

Current decision: local file-backed release candidate is `passed`; production release remains `blocked` until the target Postgres environment is available and its production readiness checks pass there.

Run `npm.cmd run launch:gate:local` from the repository root before release
tagging to refresh timestamped JSON and Markdown evidence under
`output/launch-readiness/`. The command runs the frozen local engineering and
P0 smoke gates, including the file-backed production readiness smoke, records
branch/commit/dirty files, and marks Postgres checks as
`external-blocked` when `DATABASE_URL` is not available.

The API exposes the latest generated JSON at `GET /launch/evidence/latest`;
the Requirement Delivery Console uses it only as a read-only launch health
signal.
The endpoint also annotates the evidence with the current git branch, HEAD,
dirty files, and `fresh=false` when the evidence no longer matches the working
tree.

For a Postgres-backed launch target, run `npm.cmd run launch:gate:postgres`.
That command treats missing `DATABASE_URL`, migrations, and
`smoke:api:postgres` evidence as required blockers instead of optional local
blockers.

The local file-backed runtime has passed the core P0 product proof:

1. Real repo path can be registered and safety-checked.
2. Required gate failure prevents a successful merge candidate.
3. Retry clears stale evidence and can produce passing current evidence.
4. Report and merge candidate are available only after passing gates.
5. Human apply is explicit and audited.
6. Backup/restore preserves review evidence after restart.
7. The Requirement Delivery Console proves the same flow in a real browser against the real requirement API bridge, with manual apply evidence visible and direct apply absent from the main UI path.

## Remaining Release Gates

- Refresh `npm.cmd run launch:gate:local` immediately before release tagging if any tracked file changes after `67565b8`.
- Run `npm.cmd run smoke:api:postgres` if the launch target uses `MAWO_STATE_BACKEND=postgres` or `MAWO_QUEUE_BACKEND=postgres`. This requires `DATABASE_URL`, migrated schema, and a reachable Postgres instance.
- Run `npm.cmd run launch:gate:postgres` for a Postgres-backed launch target after `DATABASE_URL` is configured and migrations are deployed.
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
