# 从原型到真实系统计划

日期：2026-06-04  
当前状态：v0.3 Agent Adapter 原型已跑通

> 2026-06-06 更新：本文件保留为技术生产化参考。产品源头已经切换到 `docs/product/PRD.md`、`docs/product/ROLE_WORKFLOW.md`、`docs/product/USER_JOURNEYS.md` 和 `docs/product/UI_INFORMATION_ARCHITECTURE.md`。后续工程实现必须先过需求、UI/API 行为、验收标准和测试计划闸口。

## 1. 当前已经具备的能力

当前系统已经证明了第一条关键链路：

```text
创建 workflow
-> 创建 git worktree
-> 写入 agent prompt
-> 调用 CLI agent adapter
-> agent 修改代码
-> 收集 diff
-> 执行 quality gate
-> 生成 ready_for_review report
```

已实现模块：

- Next.js + React Flow Run Console；
- Fastify API；
- ShellAdapter；
- CliAgentAdapter；
- GitWorktreeManager；
- LocalRunner；
- worktree demo；
- fake CLI agent demo；
- report 聚合；
- 单元测试、类型检查、lint、build。

目前它还是原型，原因是：

- workflow/run 状态存在内存里，API 重启后丢失；
- 没有真实 Codex/Claude/Cursor adapter 配置；
- 没有长任务恢复、取消、重试、并发队列；
- 没有用户项目导入和真实 repo 管理；
- 没有权限、安全策略、secret 管理；
- 没有 artifact 存储和审计日志；
- 没有 PR/merge 集成；
- 没有真实部署拓扑。

## 2. 真实系统目标

真实系统第一版不追求“全自动多 agent 公司”，而是做到：

> 用户连接一个真实代码仓库，创建一个复杂开发目标，系统能拆分/执行/隔离/验收/聚合，并给出可审查、可重跑、可合并的结果。

成功标准：

- 支持至少一个真实 AI coding CLI；
- workflow 状态可持久化；
- 每个 task 都有独立 worktree；
- 任务失败后可重跑；
- quality gate 可配置；
- report 包含日志、diff、gate、风险；
- 人类可以接受、拒绝、重跑；
- 系统重启后能恢复 workflow/run；
- 不自动破坏主仓库。

## 3. 生产架构

建议架构：

```text
Web Console
  |
  | HTTP/SSE
  v
API Server
  |
  | enqueue workflow/task jobs
  v
Runner Worker
  |
  | creates git worktrees / runs CLI agents / gates
  v
Workspace Store + Artifact Store

Postgres: workflows, tasks, runs, gates, artifacts, audit events
Redis/Queue: job scheduling, locks, transient state
Git: worktree isolation, branches, diffs
Object/File Storage: logs, patches, reports
```

MVP 真实系统可以先不引入 Temporal，但要把代码边界留出来：

- API 只创建 run 和发起 job；
- Worker 专门执行长任务；
- Runner service 不依赖 HTTP request 生命周期；
- 所有状态写入 Postgres；
- 所有日志和 patch 写入 artifact store。

当需要长流程恢复、人工审批等待、复杂重试、跨 worker 调度时，再接入 Temporal。Temporal 适合 durable execution、workflow task queue、长流程恢复和重试。

## 4. 核心模块边界

### API Server

职责：

- 创建 workflow；
- 查询 workflow/run/report；
- 发起 run/retry/cancel；
- 管理 agent 配置；
- 管理 repo 配置；
- 管理 quality gate 配置；
- 推送 SSE 状态。

不负责：

- 直接跑 agent；
- 长时间阻塞等待任务完成；
- 存储大日志。

### Runner Worker

职责：

- 拉取待执行 task；
- 创建 worktree；
- 执行 shell/CLI agent；
- 执行 gates；
- 收集 diff/log/artifact；
- 更新 task/run 状态。

### Agent Adapter

统一接口：

```ts
type AgentAdapter = {
  id: string;
  label: string;
  run(input: AgentRunInput): Promise<AgentRunResult>;
};
```

短期 adapter：

- shell；
- fake-agent；
- codex-cli；
- claude-code；
- cursor-cli，如果 CLI 能稳定非交互运行。

### Repository Manager

职责：

- 注册 repo；
- 检查 clean/dirty 状态；
- 创建 worktree；
- 删除/保留 worktree；
- 生成 patch；
- 创建 merge candidate；
- 后续创建 PR。

### Quality Gate Engine

职责：

- 运行 lint/test/typecheck/build；
- 支持自定义 gate；
- 支持 gate 超时；
- 支持 gate 失败重跑；
- 记录 stdout/stderr/exitCode/duration。

### Report Aggregator

职责：

- 汇总 task 状态；
- 汇总 gate 状态；
- 汇总 patch；
- 汇总风险；
- 生成可审查报告；
- 后续生成 PR 描述。

## 5. 数据模型

Postgres 需要先落这些表：

- `repositories`
- `workflows`
- `workflow_runs`
- `task_runs`
- `agent_runs`
- `quality_gate_runs`
- `artifacts`
- `worktrees`
- `review_decisions`
- `audit_events`

关键状态：

```text
workflow_run:
draft -> ready -> running -> needs_review -> completed
                         \-> failed
                         \-> gate_failed
                         \-> aborted

task_run:
waiting -> running -> passed
                 \-> failed
                 \-> blocked
                 \-> canceled
```

artifact 类型：

- stdout；
- stderr；
- patch；
- git status；
- prompt file；
- report；
- gate output；
- screenshots；
- generated files。

## 6. 真实 Agent 接入策略

不要一开始做所有 agent。先做一个真实 adapter，并把配置抽象正确。

优先顺序：

1. Codex CLI
2. Claude Code CLI
3. Cursor CLI

原因：

- 当前环境里已经检测到 Codex app/CLI 入口；
- Codex 官方文档有 CLI、非交互模式、worktree、sandboxing、automation 等相关能力入口；
- Claude Code 官方 CLI reference 也支持命令行使用，但本机当前未检测到 `claude` 命令。

真实 adapter 最小配置：

```json
{
  "id": "codex-cli",
  "label": "Codex CLI",
  "commandTemplate": "codex exec --cd {workspace} --file {promptFile}",
  "timeoutMs": 900000,
  "env": {}
}
```

注意：上面的 commandTemplate 是目标形态，最终参数必须以本机可执行 CLI 的实际帮助输出为准。现在已有的 `CliAgentAdapter` 正是为这个目的设计的：真实 CLI 只需要替换模板。

## 7. 安全与隔离

真实系统必须有安全边界：

- 默认每个 task 独立 worktree；
- 默认不自动 merge；
- 默认不把 secrets 写进 prompt/report；
- 限制 agent 可读写路径；
- gate 失败禁止完成；
- 所有命令有 timeout；
- 所有执行有 audit event；
- workspace 可保留或清理；
- 后续用 Docker 做更强隔离；
- 云端版本必须区分用户、组织、repo 权限。

短期安全清单：

- 命令模板白名单；
- 禁止任意用户传裸 shell；
- secret redaction；
- task 超时；
- worktree root 路径校验；
- patch 大小限制；
- log 大小限制；
- destructive command 审批。

## 8. 部署形态

第一阶段推荐本地优先：

```text
本地 Web/API/Worker
本地 git repo
本地 CLI agent
本地 Postgres/SQLite
```

原因：

- AI coding agent 通常需要本机 repo 和 CLI 登录；
- 本地 worktree 安全边界更清楚；
- 用户更容易接受“先不上传私有代码”。

第二阶段再做团队/云端：

```text
Cloud control plane
Local runner daemon
GitHub/GitLab integration
Team audit/report
```

## 9. 下一阶段路线图

### v0.4 Persistent Runs

目标：从内存状态变成可恢复状态。

交付：

- Prisma 表结构；
- workflow_runs/task_runs/agent_runs/gate_runs/artifacts；
- API 状态读写数据库；
- report 从数据库和 artifact 生成；
- API 重启后 workflow 不丢。

### v0.5 Worker Queue

目标：长任务不绑在 HTTP 请求上。

交付：

- task queue；
- runner worker；
- run/retry/cancel；
- task timeout；
- SSE 状态更新。

### v0.6 Real Codex Adapter

目标：接入第一个真实 AI coding CLI。

交付：

- 检测 codex CLI；
- 配置 codex command template；
- 执行真实 prompt；
- 捕获输出；
- worktree patch；
- gate 验收；
- 失败诊断。

### v0.7 Repository Console

目标：用户选择真实 repo 运行。

交付：

- repo 注册；
- repo 状态检查；
- branch/worktree 查看；
- run history；
- artifact browser；
- cleanup worktrees。

### v0.8 Review & Merge Candidate

目标：从报告走向可交付。

交付：

- diff viewer；
- accept/reject/retry；
- merge candidate；
- PR description；
- 后续 GitHub PR 创建。

## 10. 立即开工建议

下一步应该先做 `v0.4 Persistent Runs`。

理由：

- 真实系统最先需要“状态不丢”；
- 没有持久化，真实 agent 长任务、失败恢复、审计都做不稳；
- 现在 runner/API 边界已经够清楚，正适合落数据库。

v0.4 第一批任务：

1. 扩展 Prisma schema；
2. 写 repository 层；
3. 把 LocalRunner 状态同步到 Postgres；
4. artifact 写入本地 `.mawo/artifacts`；
5. API 从数据库返回 workflow/report；
6. 加测试覆盖 API 重启后仍可读取 run。

## 参考来源

- OpenAI Codex CLI docs: https://developers.openai.com/codex/cli
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- Temporal TypeScript SDK developer guide: https://docs.temporal.io/develop/typescript
- Prisma config reference: https://www.prisma.io/docs/orm/reference/prisma-config-reference
