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
| 2026-06-06 | Freeze P0 as Requirement Delivery Ticket plus real repo safety acceptance loop | Product, PM, user, UI, tech, frontend, backend, and QA/Ops reviews converged on this scope | `docs/product/REQUIREMENTS_FREEZE.md` is the source of truth before UI work |
| 2026-06-06 | Treat `RequirementDeliveryTicket` as a first-class product entity and `WorkflowRun` as execution evidence | Requirement lifecycle and execution attempts have different semantics | Old workflow/runner code is reused as execution layer, not discarded |
| 2026-06-06 | Cancel the old auto-continue heartbeat until requirements and UI are accepted | The team must stop implementation-by-momentum | Work resumes through explicit UI/API contract and slice gates |
| 2026-06-06 | Start UI phase with a requirement-oriented view model before page rewrites | This preserves the old execution layer while shifting the product language away from raw workflows | `delivery-console-model.ts` maps existing `WorkflowRun` data into requirement summaries, KPIs, and decisions |
