# MAWO 项目规划

日期：2026-06-06
状态：产品先行规划 v0.2
当前产品名：MAWO / Agent Orchestration System

## 1. 最新定位

首发阶段不要再把产品卖成宽泛的“多 Agent 编排平台”。这个说法太大，也很容易被用户理解成另一个 LangGraph、Dify、n8n 或通用自动化平台。

当前最清晰、最有购买理由的定位是：

> 本地代码 Agent 的安全验收台：把真实仓库里的 AI agent 改动变成隔离、可验收、可重跑、可审计、可合并的 patch。

一句话解释：

> 用户选择真实本地 git 仓库，输入明确任务和质量门，MAWO 在独立 worktree 里运行 shell 或 CLI agent，收集 diff、日志、gate 结果和报告，最后生成 merge candidate，由人类决定是否应用 patch。

## 2. 为什么调整方向

用户和买方代表已经指出：客户不会因为“多 agent 编排”这个概念付费。客户愿意试用，是因为他们现在已经在用 Codex、Claude Code、Cursor 等 coding agent，但不敢轻易把 agent 结果合进真实仓库。

最强痛点不是“让多个 agent 自动协作”，而是：

- agent 改了哪些文件不够清楚；
- 是否污染主仓库不够清楚；
- 测试、lint、typecheck、build 是否真的跑过不够清楚；
- gate 失败时 agent 仍可能给积极总结；
- retry 容易混入旧 diff、旧 gate、旧 review；
- 给同事或客户 review 时缺少完整证据链。

所以首发闭环先证明“可信交付”，再扩展“复杂编排”。

## 3. 首发目标用户

| 用户 | 价值 |
| --- | --- |
| 高频使用 AI coding agent 的独立开发者 | 减少手动建 worktree、拷日志、跑测试、整理 patch 的成本 |
| 2-10 人 AI-native 小团队技术负责人 | 让团队能用统一证据审查 agent 输出 |
| 外包或自动化交付团队 | 给客户/同事交付带日志、diff、gate、风险和 apply 命令的结果 |

暂不优先：

- 完全不懂 git 和代码的用户；
- 大型企业治理平台；
- 通用办公自动化；
- 云端多租户；
- 自动 PR/自动合并/自动冲突解决。

## 4. 产品原则

1. 可信优先：用户先知道“能不能 review/apply”，不是先看 agent 聊天内容。
2. 人类可控：默认不自动改主分支，不自动合并。
3. 真实 repo 优先：demo 只是辅助，首发价值必须在真实本地仓库里证明。
4. 失败一等公民：dirty repo、agent 未配置、gate failed、timeout、cancel 都要有清楚下一步。
5. 需求先行：没有用户场景、验收标准、UI/API 行为和测试计划，不进入开发。

## 5. P0 范围

P0 只做能证明“真实 repo 安全验收”的能力：

1. 需求交付单
   - 记录 repo、目标、任务、约束、非目标、验收标准、质量门和风险。

2. 真实本地 repo 工作流
   - 检查 git repo、HEAD、branch、dirty 状态、allowed root。
   - 明确展示不会自动修改主分支。

3. 手动任务输入
   - 支持 1-5 个明确任务。
   - 自动拆任务延后，避免未验证前过度承诺。

4. Shell + 可配置 CLI agent
   - shell 稳定可用。
   - Codex/Claude/Cursor 等通过 command template 接入。
   - 未配置时显示 unavailable，不假装可用。

5. Worktree 隔离
   - 每个 task 独立 worktree。
   - 收集 stdout、stderr、exit code、git status、diff、patch。

6. 质量门控
   - 支持 test/lint/typecheck/build/custom gate。
   - 必选 gate 失败时阻止 merge-ready 结论。

7. Report 和 merge candidate
   - report 汇总 changed files、patch、gate、artifact、风险、下一步。
   - merge candidate 只对通过 gate 的结果生成，并给出 `git apply`。

8. Retry / cancel / persistence
   - 支持取消 queued/running job。
   - retry 不能混入 stale result。
   - API/Web 重启后仍可看 workflow、report、artifact、audit。

## 6. P1 / P2

P1：

- 需求优先控制台；
- artifact 浏览器；
- worktree 清理策略；
- agent health 和配置诊断；
- viewer/operator 评审工作流；
- Postgres 队列和 worker 部署硬化。

P2：

- 自动任务拆解；
- 完整 DAG 编辑器；
- 多 agent 同题竞赛；
- 自动 PR；
- 自动冲突解决；
- 云端控制台；
- 团队权限、SSO、成本预算、长期记忆。

## 7. 下一步最高价值切片

先写 Feature Brief，再开发：

> 真实 repo 成功 -> gate 失败 -> retry 成功 -> merge candidate。

验收必须证明：

1. 用户能选择真实 repo 并看到安全状态。
2. 用户能创建需求交付单。
3. 任务在独立 worktree 运行。
4. gate 失败时不能生成成功 merge candidate。
5. retry 后旧 patch/gate/review 不再作为当前结果。
6. gate 通过后能生成带证据的 merge candidate。

## 8. 需求先行文件

后续以这些文件为产品源头：

- `docs/product/PRD.md`
- `docs/product/ROLE_WORKFLOW.md`
- `docs/product/USER_JOURNEYS.md`
- `docs/product/UI_INFORMATION_ARCHITECTURE.md`
- `docs/product/FEATURE_BRIEF_TEMPLATE.md`
- `docs/product/DECISION_LOG.md`

旧的实现计划和生产化计划仍有参考价值，但任何代码工作都必须先通过上述需求与设计闸口。
