# 多 Agent 工作流编排平台项目规划

日期：2026-06-04  
状态：产品规划草案 v0.1

## 1. 项目定位

一句话定位：

> 面向复杂软件项目的多 AI Coding Agent 编排与质量验收平台。

当前 Claude Code、Codex、Cursor 等 AI coding agent 已经能独立完成不少开发任务，但复杂项目里仍有几个核心问题：

- 任务如何拆解给不同 agent；
- 多个 agent 如何隔离执行，避免互相覆盖；
- 输出如何验收，而不是只看聊天记录；
- 多份结果如何汇总、比较、合并；
- 人类如何在关键节点介入审批。

本项目要做的不是“聊天机器人集合”，而是一个把多个 agent 当成可管理工作单元的工程编排系统。

## 2. 目标用户

优先 ICP：

- 高频使用 AI coding agent 的独立开发者；
- 2-10 人的 AI-native 开发团队；
- 外包工作室或自动化交付团队；
- 需要同时维护多个代码仓库的小型 SaaS 团队；
- 技术负责人，希望把 AI agent 纳入更可控的研发流程。

暂不优先：

- 完全不写代码的非技术用户；
- 大型企业级平台治理场景；
- 通用办公自动化多 agent 编排；
- 纯聊天式 agent 协作。

## 3. 核心用户任务

主要 JTBD：

> 当我有一个复杂开发目标时，我想让系统自动拆解任务、分配给多个 AI coding agent、隔离执行并自动验收，这样我可以更快得到一个可信的可合并结果。

关键使用场景：

- 一次性实现一个中等复杂功能；
- 修复一组相关 bug；
- 让多个 agent 并行探索不同实现方案；
- 一个 agent 写代码，另一个 agent 做 review；
- 一个 agent 做前端，一个 agent 做后端，一个 agent 写测试；
- 将最终结果汇总成 diff、测试报告、风险说明和合并建议。

## 4. 产品原则

- 可信优先：用户最需要知道“能不能合并”，不是“agent 说了什么”。
- 人类可控：关键节点保留审批、暂停、重试、改派、回滚。
- 隔离执行：每个 agent 默认在独立 worktree、容器或临时环境中运行。
- 状态透明：每个任务的输入、输出、日志、diff、测试结果都可追踪。
- 先专注 coding agent：先把软件开发工作流做好，再扩展到通用 agent 编排。

## 5. MVP 范围

### P0 必须有

1. 项目目标输入
   - 用户输入自然语言目标；
   - 支持附加约束、技术栈、测试要求、禁止事项。

2. 自动任务拆解
   - 将目标拆成任务 DAG；
   - 每个任务包含目标、上下文、验收标准、依赖关系。

3. Agent 执行器适配
   - 至少先支持 2 类执行器：
     - 本地 shell/script 执行器；
     - 一个 AI coding CLI 执行器，例如 Codex 或 Claude Code。
   - 统一记录 stdout、stderr、退出码、耗时、成本字段。

4. 工作区隔离
   - 每个任务创建独立 git worktree 或临时分支；
   - 保留任务开始前后的 diff；
   - 支持清理、保留、重跑。

5. 质量门控
   - 支持配置 lint、test、typecheck、build；
   - 每个 gate 有通过/失败/跳过状态；
   - gate 失败时阻止自动合并。

6. 结果聚合
   - 展示每个任务的状态、diff、测试结果、风险；
   - 汇总成最终交付报告；
   - 人类选择接受、拒绝、重跑或手动合并。

7. 可视化任务图
   - 展示 DAG 节点、依赖、状态；
   - 节点详情展示 agent 日志、产物和 gate 结果。

### P1 可延后

- 多 agent 同题并行竞赛；
- 自动冲突合并建议；
- Agent 能力画像和自动派单；
- Prompt 模板库；
- 项目级长期记忆；
- 成本预算和 token 预算；
- 团队协作权限。

### 明确不做

- 不做通用 Zapier 式自动化平台；
- 不做模型供应商大而全控制台；
- 不在 MVP 阶段做企业权限、审计、SSO；
- 不承诺完全自动合并到主分支；
- 不把所有 agent 行为都交给 LLM 自由决策。

## 6. 端到端用户流程

1. 用户选择代码仓库。
2. 用户输入目标，例如“实现 Stripe 订阅计费并补齐测试”。
3. 系统生成任务 DAG：
   - 需求澄清；
   - 数据模型修改；
   - API 实现；
   - 前端页面；
   - 测试补齐；
   - review 与验收。
4. 用户确认或编辑任务图。
5. 系统为每个任务创建隔离工作区。
6. Agent 执行任务并持续回传状态。
7. 质量门控自动运行。
8. 系统聚合 diff、日志、测试结果和风险。
9. 用户查看最终报告并决定：
   - 合并；
   - 局部接受；
   - 重跑失败任务；
   - 改派给另一个 agent；
   - 放弃并清理工作区。

## 7. 技术架构建议

### 前端

- Next.js / React；
- React Flow 作为任务图和工作流画布；
- Tailwind CSS 或现有设计系统；
- SSE/WebSocket 展示实时执行状态。

### 后端

- 推荐优先：Node.js + TypeScript；
- 可选：Python FastAPI，如果更偏 LangGraph/Python agent 生态；
- API 层负责项目、工作流、任务、执行器、质量门控、报告。

### 编排层

MVP 可以先做轻量状态机：

- Workflow；
- Task；
- Dependency；
- Run；
- Gate；
- Artifact；
- ReviewDecision。

后续如果出现长时间运行、重试、恢复、人工审批复杂化，可以接入 Temporal。Temporal 的优势是 durable execution、重试、暂停恢复、task queue 和长流程可观测性。

### Agent 适配层

采用统一 adapter 接口：

```ts
interface AgentAdapter {
  id: string;
  label: string;
  capabilities: AgentCapability[];
  run(input: AgentRunInput): AsyncIterable<AgentRunEvent>;
  cancel(runId: string): Promise<void>;
}
```

首批 adapter：

- `shell`：执行本地命令和脚本；
- `codex-cli`：通过 CLI/exec 模式运行；
- `claude-code`：通过非交互 CLI 或 SDK 运行；
- `cursor-agent`：等 CLI 稳定后接入。

### 隔离层

优先策略：

- 每个任务一个 git worktree；
- 每个 worktree 一个任务分支；
- gate 在该 worktree 内执行；
- 聚合阶段只读取 diff，不直接改主分支。

增强策略：

- Docker 容器执行；
- 资源限制；
- 网络开关；
- 文件写入范围限制；
- secret 注入与脱敏。

### 数据库

推荐 Postgres：

- workflow_runs；
- tasks；
- task_runs；
- agent_runs；
- artifacts；
- quality_gates；
- repository_snapshots；
- merge_candidates；
- audit_events。

可选：

- pgvector：存储项目上下文、任务历史、代码摘要；
- Redis：运行中状态、队列、短期缓存。

## 8. 关键模块拆解

### A. Workflow Designer

功能：

- 创建任务图；
- 编辑节点；
- 编辑依赖；
- 选择 agent；
- 配置 gate。

验收标准：

- 用户能从目标生成 DAG；
- 用户能手动增删任务；
- DAG 无循环；
- 每个 P0 任务都有验收标准。

### B. Task Planner

功能：

- 将目标拆成结构化任务；
- 输出任务说明、依赖、验收标准；
- 给出建议 agent 类型。

验收标准：

- 对中等复杂需求生成 5-12 个任务；
- 任务粒度可执行；
- 不把所有工作塞进一个节点。

### C. Agent Runner

功能：

- 调用不同 agent；
- 记录流式日志；
- 记录退出状态；
- 支持取消、重试、超时。

验收标准：

- 可以运行 shell adapter；
- 可以运行至少一个 AI coding CLI adapter；
- 失败时能保留日志和工作区。

### D. Quality Gate Engine

功能：

- 执行 lint/test/typecheck/build；
- 支持自定义命令；
- 支持 gate 依赖；
- 生成 gate 报告。

验收标准：

- gate 失败时阻止合并；
- gate 结果和日志可查看；
- 可以重跑单个 gate。

### E. Result Aggregator

功能：

- 汇总 diff；
- 汇总任务状态；
- 汇总 gate 结果；
- 给出合并建议和风险。

验收标准：

- 最终报告包含 changed files、passed gates、failed gates、open risks；
- 用户能从报告跳转到任务详情。

## 9. 第一版界面规划

### 主界面：Run Console

左侧：

- 项目选择；
- workflow/run 列表；
- agent 列表。

中间：

- React Flow 任务图；
- 节点状态：waiting/running/blocked/passed/failed/reviewing。

右侧：

- 当前节点详情；
- prompt/input；
- agent log；
- diff；
- quality gate；
- 人工操作按钮。

底部：

- 全局执行时间线；
- 成本、耗时、失败原因；
- 最终报告入口。

### 核心状态

- Draft：任务图草稿；
- Ready：已确认，可执行；
- Running：运行中；
- GateFailed：质量门控失败；
- NeedsReview：等待人工审批；
- Completed：完成；
- Aborted：取消；
- Archived：归档。

## 10. 里程碑计划

### Phase 0：发现与验证，1-2 周

目标：

- 验证“多 agent 编排 + 质量门控”是不是第一痛点；
- 找到 5-8 个高频 AI coding agent 用户访谈；
- 确认第一个垂直场景。

交付物：

- 访谈记录；
- ICP 描述；
- 3 个真实任务样本；
- 风险假设清单；
- MVP 范围定稿。

通过标准：

- 至少 3 个用户有明确现有 workaround；
- 至少 2 个用户愿意试用原型；
- 用户能说出最近一次“多个 agent 不好协作”的具体失败经历。

### Phase 1：本地原型，2-3 周

目标：

- 先证明编排和验收链路跑得通。

交付物：

- 本地 Web UI；
- 任务 DAG 编辑；
- shell adapter；
- git worktree 隔离；
- lint/test gate；
- 简单报告。

通过标准：

- 能对一个真实 repo 执行 3-5 个任务；
- gate 失败能阻止完成；
- 每个任务都能看到日志、diff 和结果。

### Phase 2：AI CLI Adapter，2-4 周

目标：

- 接入第一个真实 coding agent。

交付物：

- Codex 或 Claude Code adapter；
- prompt 模板；
- 流式日志；
- 超时和取消；
- 重跑失败任务。

通过标准：

- 可以让 agent 在隔离 worktree 中完成小功能；
- 执行结果可被测试 gate 验收；
- 用户无需手动复制粘贴 prompt。

### Phase 3：结果聚合与人工审批，2-3 周

目标：

- 让用户敢于从平台拿结果。

交付物：

- 汇总报告；
- diff 对比；
- 合并候选；
- 风险标注；
- 接受/拒绝/重跑/改派。

通过标准：

- 用户能根据报告判断是否合并；
- 系统能解释失败任务和阻塞点；
- 单个任务失败不影响其他任务结果保留。

### Phase 4：Beta，4-6 周

目标：

- 找 5-10 个真实用户跑真实项目。

交付物：

- 安装文档；
- 本地运行包；
- 任务模板；
- 反馈收集；
- 基础遥测。

通过标准：

- 至少 5 个真实 workflow run；
- 至少 2 个用户完成可合并交付；
- 用户愿意继续使用或付费试点。

## 11. 成功指标

MVP 阶段：

- Time to first successful run：小于 20 分钟；
- Successful workflow rate：大于 50%；
- Gate visibility：每次 run 都有可追踪 gate 结果；
- Manual copy-paste prompt 次数：相比手动 agent 协作减少 70%；
- 用户能否用报告做合并判断：访谈评分大于 8/10。

Beta 阶段：

- 每周活跃 workflow run；
- 每个 workflow 平均任务数；
- gate 失败后重跑成功率；
- 用户保留率；
- 用户愿意支付的价格区间。

## 12. 高风险假设

| 假设 | 风险 | 当前确定性 | 验证方式 |
|---|---:|---:|---|
| 用户真的需要多个 agent 并行协作 | 高 | 中 | 访谈 + fake door |
| 质量门控比“更多 agent”更有价值 | 高 | 中 | 原型测试 |
| CLI adapter 可以稳定自动化 | 高 | 中 | 技术 spike |
| git worktree 足够支撑 MVP 隔离 | 中 | 高 | 本地原型 |
| 结果聚合能显著减少 review 成本 | 高 | 低 | 可用性测试 |
| 用户愿意为本地开发编排工具付费 | 高 | 低 | 价格访谈 |

## 13. 发现实验

### 实验 1：问题访谈

对象：

- 每周使用 AI coding agent 超过 5 小时的人；
- 最近一个月尝试过让多个 agent 处理同一项目的人。

问题：

- 最近一次复杂任务是怎么拆给 agent 的？
- 哪一步最痛？
- 是否出现过输出互相覆盖、上下文丢失、测试不可信？
- 当前用什么 workaround？
- 如果有一个平台帮你拆解、隔离、验收、聚合，你最想先用在哪类任务？

成功标准：

- 5-8 个访谈里至少 4 个提到相同痛点；
- 至少 3 个有明确 workaround；
- 至少 2 个愿意给真实 repo 试用。

### 实验 2：Fake Door

做一个低保真页面：

- 输入项目目标；
- 选择 agent；
- 生成任务图；
- 显示“运行多 agent workflow”按钮。

成功标准：

- 目标用户愿意点击运行；
- 愿意留下邮箱或约试用；
- 愿意上传/连接真实 repo 的比例可接受。

### 实验 3：Concierge Run

人工在幕后用多个 agent 跑一次真实任务，然后给用户交付报告。

成功标准：

- 用户认为报告比手动看 agent 输出更清晰；
- 用户能用报告做是否合并的判断；
- 用户愿意让系统下一次自动化更多步骤。

## 14. 建议技术选择

短期推荐：

- Next.js + React + React Flow；
- Node.js + TypeScript；
- Postgres；
- Git worktree；
- Docker 可选；
- 自研轻量状态机；
- Codex/Claude Code CLI adapter 先做一个；
- SSE/WebSocket 实时日志。

中期增强：

- Temporal 用于 durable workflow；
- MCP 用于统一工具、资源和上下文协议；
- LangGraph 用于 planner 或复杂 agent graph；
- pgvector 用于项目上下文和历史 run 检索；
- OpenTelemetry 用于 agent run trace。

选择理由：

- React Flow 适合节点和边组成的交互式 flowgraph；
- Temporal 适合长流程、重试、暂停恢复和人工介入；
- LangGraph 适合 orchestrator-worker、routing、parallelization 等 agent workflow pattern；
- MCP 有官方 SDK，可用于工具、资源、prompt 的标准化接入；
- Claude Code、Codex、Cursor 都已经存在 CLI/自动化入口，适合作为第一批 adapter。

## 15. 需要装备的能力

产品能力：

- 产品发现；
- ICP 和用户访谈；
- PRD 写作；
- 路线图规划；
- 定价和商业化验证。

工程能力：

- React/Next.js 前端；
- React Flow 可视化编辑器；
- Node.js/TypeScript 后端；
- 状态机和 DAG 编排；
- Git worktree/branch/diff；
- CLI 子进程管理；
- Docker/sandbox；
- WebSocket/SSE；
- Postgres 数据建模；
- 日志和追踪。

AI/Agent 能力：

- Prompt 模板设计；
- Agent adapter 抽象；
- Codex/Claude Code/Cursor CLI 自动化；
- MCP；
- LangGraph；
- 结果评估和 guardrails；
- 上下文压缩与检索。

质量能力：

- lint/test/typecheck/build gate；
- Playwright/E2E；
- 自动 code review；
- 安全扫描；
- 回滚和失败恢复；
- CI/CD 集成。

## 16. 初始开发 Backlog

### Sprint 1

- 创建项目骨架；
- 建立 Workflow/Task/Run 数据模型；
- 实现任务 DAG JSON schema；
- 实现 React Flow 静态任务图；
- 实现 shell adapter；
- 实现任务状态机。

### Sprint 2

- 接入 git worktree；
- 实现任务运行日志；
- 实现 quality gate 命令配置；
- 实现 gate 执行和结果展示；
- 生成 run report。

### Sprint 3

- 接入第一个 AI CLI adapter；
- 实现 prompt 模板；
- 实现流式输出；
- 支持取消/超时/重试；
- 支持任务失败后的重跑。

### Sprint 4

- 实现结果聚合；
- 实现 diff 浏览；
- 实现人工审批；
- 实现合并候选；
- 做 2-3 个真实 repo 测试。

## 17. 开放问题

- 第一个 adapter 先做 Codex 还是 Claude Code？
- 第一批用户更偏个人本地工具，还是团队协作平台？
- 是否坚持本地优先，还是一开始做云端控制台？
- 自动拆任务是否必须用 LLM，还是先用模板化 workflow？
- 最终合并由平台执行，还是只生成 patch/PR？
- 是否把“review agent”作为首个强卖点？

## 18. 推荐下一步

1. 做 5-8 个问题访谈。
2. 同时做本地技术 spike：
   - git worktree；
   - shell adapter；
   - quality gate；
   - run report。
3. 用一个真实 repo 跑 concierge 流程。
4. 决定第一个 AI CLI adapter。
5. 开始 MVP 原型。

## 参考来源

- LangGraph workflows and agents: https://docs.langchain.com/oss/python/langgraph/workflows-agents
- Temporal durable execution: https://docs.temporal.io/
- React Flow core concepts: https://reactflow.dev/learn/concepts/terms-and-definitions
- Model Context Protocol SDKs: https://modelcontextprotocol.io/docs/sdk
- Claude Code Agent SDK: https://code.claude.com/docs/en/agent-sdk
- OpenAI Codex CLI: https://developers.openai.com/codex/cli
