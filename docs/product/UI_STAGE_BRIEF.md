# UI Stage Brief

Date: 2026-06-06
Status: UI stage active

This brief starts the UI phase after requirements freeze. It is limited to the first-screen Requirement Delivery Console and New Requirement flow.

## 1. Feature

Requirement Delivery Console: a product-first first screen that helps users create, monitor, review, retry, and hand off requirement delivery tickets for real local repositories.

## 2. User Value

When a user opens MAWO, they should immediately know:

- which requirements need attention;
- whether the selected repository is safe;
- which stage each requirement is in;
- whether gates passed or blocked merge-ready output;
- what the next human decision is;
- where the review evidence and manual `git apply` command are.

The UI must make the product feel like a safety and acceptance console, not a demo runner.

## 3. P0 UI Scope

This UI stage includes:

- first-screen `RequirementDeliveryConsole`;
- `New Requirement` primary CTA and flow;
- `Requirement Queue`;
- `Repository Safety Card`;
- `Requirement Stage Stepper`;
- `Decision Queue`;
- `Gate Result Panel`;
- `Review Evidence / Merge Candidate Panel`;
- `Artifact Drawer`;
- `Viewer Mode Banner`;
- secondary `Legacy Run Console` path.

This UI stage does not include P1/P2 promises from the freeze document.

## 4. Desktop Layout Contract

Desktop uses a dense operational layout, not a marketing layout.

```text
Top Bar:
Repo Selector | Search | New Requirement | API/Worker/Queue Health | Settings

KPI Row:
Active | Needs Clarification | Running | Failed Gates | Waiting Review | Delivered 7d

Main:
Requirement Queue | Requirement Delivery Console | Decision Queue

Bottom:
Collapsed Ops Strip | Failed jobs | Audit highlights | Legacy Run Console
```

Recommended widths:

- left queue: 280-360px;
- center work area: min 520px, flexible;
- right decisions: 280-340px;
- max readable workspace: 1440-1680px.

No long stdout, stderr, raw JSON, full patch, or artifact path should dominate the first screen.

## 5. Mobile Layout Contract

Mobile is single-column:

1. compact top bar;
2. repository safety;
3. decision queue;
4. selected requirement stage stepper;
5. requirement queue;
6. collapsed operations / legacy console.

No horizontal tables. Queue rows become compact list cards.

## 6. Component Contracts

### Requirement Queue

Each row/card shows:

- title;
- repository;
- stage;
- risk;
- gates summary;
- next action;
- updated time.

The queue is about requirements, not workflow/job IDs.

### Repository Safety Card

Must show before run/apply actions:

- repository path;
- branch;
- HEAD short SHA;
- clean/dirty state;
- allowed-root status;
- no-auto-merge contract;
- blocked reasons and recovery action.

Dirty repository blocks mutating runs and apply in P0.

### Stage Stepper

User-facing stages:

```text
Draft -> Clarify -> Plan -> Run -> Gates -> Review -> Delivered
```

Mapping must follow `docs/product/REQUIREMENTS_FREEZE.md`.

### Decision Queue

Only shows human decisions:

- complete requirement;
- confirm plan;
- clean repository;
- configure missing agent;
- retry failed gate;
- review evidence;
- view manual apply command.

It must not show ordinary logs.

### Review Evidence / Merge Candidate

Shows:

- changed files summary;
- required/optional gate status;
- risks;
- artifact links;
- patch path;
- `git apply` command;
- manual-apply-only policy.

Direct apply is not the main action.

## 7. Minimum View Model Contract

The first implementation may adapt existing `WorkflowRun` data into a requirement-oriented view model.

Required frontend helpers:

- map execution status to requirement stage;
- derive next action;
- build KPI row;
- build decision queue;
- hide raw workflow/job language from first-screen copy;
- preserve legacy execution support.

The first helper is implemented in `apps/web/src/components/delivery/delivery-console-model.ts`.

## 8. API Contract Target

The UI should be designed around this requirement-oriented API even if the first backend implementation delegates to existing workflow endpoints:

```text
POST /requirements
GET /requirements
GET /requirements/:id
PATCH /requirements/:id
POST /requirements/:id/confirm-plan
POST /requirements/:id/enqueue
POST /requirements/:id/retry
GET /requirements/:id/report
GET /requirements/:id/merge-candidate
```

Minimum shared contract:

- `requirementDeliveryTicketSchema`;
- `requirementStatusSchema`;
- `repositorySafetySchema`;
- `decisionQueueItemSchema`;
- `requirementRunLinkSchema`;
- viewer/operator action permissions.

## 9. Testing Plan

Start with pure function tests before page implementation:

- delivery console model;
- requirement payload;
- repository safety display;
- decision queue display;
- stage stepper;
- gate result display;
- merge candidate evidence display.

Then add:

- API contract/smoke for `/requirements`;
- Playwright smoke for first screen and New Requirement flow;
- desktop and mobile screenshots for normal, dirty repo, gate failed, needs review, and viewer mode.

## 10. First TDD Slice

Implemented first:

- `apps/web/src/components/delivery/delivery-console-model.test.ts`
- `apps/web/src/components/delivery/delivery-console-model.ts`

This maps legacy `WorkflowRun` execution state into requirement summaries, KPIs, and decision queue items. It lets the new UI consume requirement language while preserving the existing execution layer.

## 11. Entry Criteria For Next Engineering Slice

Next slice may start when:

- this brief is committed;
- delivery model tests pass;
- UI wireframe contract is accepted;
- no P1/P2 scope is introduced;
- the next change has a failing test first.
