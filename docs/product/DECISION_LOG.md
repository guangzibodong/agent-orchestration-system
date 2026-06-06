# Product Decision Log

Date: 2026-06-06
Status: active

| Date | Decision | Rationale | Impact |
| --- | --- | --- | --- |
| 2026-06-06 | Lead positioning with "local coding agent safety and acceptance console" instead of "multi-agent orchestration platform" | Buyers do not pay for orchestration language; they pay for safer, faster, reviewable code changes | README, PRD, UI IA, and future demos should emphasize isolated worktrees, gates, reports, and merge candidates |
| 2026-06-06 | Make requirement delivery ticket the primary product object | Current UI is execution-first and feels like an operations console | Next UI work should start from requirements, decisions, and review readiness |
| 2026-06-06 | Manual tasks remain P0; automatic decomposition moves to P2 | Manual tasks are enough to prove trust and are easier to validate with real users | Avoid building planning automation before the trust loop is proven |
| 2026-06-06 | Gate failure must block merge-ready conclusions | False confidence is the highest trust risk | QA must cover gate failure, disabled review, retry, and report messaging |
| 2026-06-06 | No automatic main-branch modification in MVP | Users need control and safety | Merge candidate provides patch and `git apply`, not silent merge |
| 2026-06-06 | Development requires PRD/brief, UI behavior, acceptance, and test plan | User explicitly rejected building by feeling | `docs/product/ROLE_WORKFLOW.md` becomes the working agreement |
