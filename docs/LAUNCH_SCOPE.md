# MAWO 最快上线产品切片

日期：2026-06-05  
角色视角：产品经理  
目标版本：v0.9 Local Launch Candidate  

## 1. 上线目标

最快上线版本不追求完整多 Agent 平台，而是把当前原型收敛成一个本地优先、工程团队敢用的交付工具：

> 用户选择一个真实 git 仓库，提交一组明确任务，系统在隔离 worktree 中调用 shell 或已配置 CLI agent 执行任务，跑质量门，生成可审查报告和 merge candidate，由人类决定是否应用 patch。

这个版本的核心价值是“让 AI coding agent 的输出可隔离、可验收、可重跑、可审查”，而不是“自动理解所有需求并全自动合并”。

## 2. 首发用户与使用场景

首发用户：

- 高频使用 Codex、Claude Code、Cursor 等 coding agent 的独立开发者；
- 2-10 人 AI-native 小团队中的技术负责人；
- 需要把 agent 输出交给别人 review 的外包或自动化交付团队。

首发场景：

- 对真实 repo 跑 1-5 个明确任务；
- 每个任务可以是 shell 命令、测试修复、代码改动、生成报告或小功能实现；
- 用户已经知道要做什么，只需要平台帮忙隔离执行、记录输出、跑 gate、汇总 patch；
- 最终合并仍由用户在主仓库手动执行 `git apply` 或后续手动开 PR。

非首发场景：

- 非技术用户用自然语言创建完整软件；
- 云端团队协作平台；
- 自动拆解大型需求并自动派给多个 agent；
- 自动解决 patch 冲突并合并主分支；
- 企业权限、SSO、审计报表和组织级治理。

## 3. 上线版本范围

### 必须有

1. 真实仓库工作流
   - 支持用户输入本地 git repo 路径；
   - 要求 repo 有已提交的 `HEAD`；
   - 运行前检查 repo 路径存在且是 git 仓库；
   - 若主仓库 dirty，必须明确提示风险，默认不运行会改代码的任务。

2. 手动任务输入
   - 用户可以提交 `goal`、`tasks`、`qualityGates`；
   - 每个 task 至少包含 `id`、`title`、`agent`、`command` 或 agent prompt、`timeoutMs`；
   - 暂不要求 LLM 自动拆任务；
   - UI/API 都要能承载 1-5 个任务的工作流。

3. Agent 执行
   - `shell` agent 必须稳定可用；
   - `fake` demo agent 可保留用于演示和测试；
   - 至少支持一个真实 CLI agent 的环境变量配置入口，例如 `MAWO_CODEX_COMMAND_TEMPLATE`；
   - CLI agent 未配置时，UI/API 要显示 unavailable 或缺配置，不允许假装可运行。

4. Worktree 隔离
   - 每个 task 在独立 git worktree 中运行；
   - prompt 文件、内部 orchestration 文件不得污染 task patch；
   - task 结束后必须收集 patch 和 `git status`；
   - worktree 可以保留给用户排查，也可以通过明确操作清理。

5. 质量门
   - 支持用户配置 lint/test/typecheck/build 或任意明确 gate command；
   - 每个 gate 必须记录 stdout、stderr、exitCode、duration、timeout；
   - 任一必选 gate 失败时 workflow 状态进入 `gate_failed` 或等价失败态；
   - gate 失败不得生成“可直接合并”的成功结论。

6. 持久化与 artifact
   - workflow 状态、任务结果、review 决策在本地重启后可读；
   - 日志、patch、report、merge candidate 写入 `.mawo/artifacts`；
   - API 重启后可通过 workflow id 重新查看 report。

7. Review 与 merge candidate
   - report 汇总 task 状态、changed files、patch 路径、gate 结果、失败原因；
   - 用户可以 approve、reject、retry；
   - 只对 passed task 生成 merge candidate patch；
   - merge candidate 必须给出明确 `git apply` 命令；
   - 产品文案必须强调：平台不自动修改主分支。

8. 最小 Web Console
   - 能创建 repository workflow；
   - 能看到 workflow 列表和状态；
   - 能看到任务、gate、report、merge candidate；
   - 能执行 enqueue/run、retry、approve/reject；
   - 不要求华丽 DAG 编辑器，但状态必须清楚。

9. 本地启动文档
   - README 或 docs 中给出从 clone 到运行的命令；
   - 说明 PATH、env、CLI agent command template、示例 payload；
   - 写清楚当前依赖 Docker/Postgres/Redis 是否必须。

### 必须延后

- 自动 LLM 任务拆解和 DAG 编辑器；
- 多 agent 同题竞赛与方案打分；
- 自动 patch 冲突解决；
- 自动创建 GitHub/GitLab PR；
- 云端控制台和 local runner daemon；
- 团队、组织、权限、SSO；
- 成本预算、token 预算、agent 能力画像；
- 长期项目记忆、向量检索、prompt 模板库；
- Docker 强隔离和网络策略，除非 24 小时内已有稳定实现；
- Temporal、Postgres、Redis 生产拓扑，当前首发可继续本地文件持久化。

## 4. 验收标准

上线候选必须通过以下验收，未通过则不能标记为 launch-ready。

### 功能验收

- 能对一个真实本地 repo 创建 workflow；
- 能运行至少 2 个 task，其中至少 1 个会产生代码 diff；
- 每个 task 都创建独立 worktree；
- 任务完成后 report 能展示 patch、git status、stdout/stderr artifact；
- 能运行至少 1 个 quality gate；
- gate 通过时可生成 merge candidate；
- gate 失败时不能生成成功结论，并能 retry；
- approve/reject/retry 在 UI 和 API 至少一端可用，最好两端都可用；
- API 重启后 workflow/report/merge candidate 仍可查看。

### 质量验收

- `npm run test` 通过；
- `npm run typecheck` 通过；
- `npm run lint` 通过；
- `npm run build` 通过；
- 至少有一条自动化测试覆盖“重启后 workflow 可读”或现有等价持久化行为；
- 至少有一条自动化测试覆盖“gate 失败阻止成功/merge candidate”；
- 至少有一条自动化测试覆盖“retry 清理 stale result 并回到 ready/waiting”。

### 可用性验收

- 新用户 20 分钟内可以完成 first successful run；
- 用户无需手动复制 agent 输出，report 中能找到关键日志和 patch；
- merge candidate 页面对下一步操作没有歧义；
- 当 CLI agent 未配置、repo 无效、gate 失败、任务 timeout 时，错误信息能指导下一步。

### 安全与边界验收

- 默认不自动合并主分支；
- 所有 task 和 gate 都有 timeout；
- 命令模板来自配置，不允许任意远程用户提交裸 shell 模板作为 agent adapter；
- artifact/log 有合理大小上限或至少在风险清单中明确；
- prompt 文件不进入 captured patch；
- 主 repo dirty 时有保护或明确警告。

## 5. 24 小时冲刺里程碑

目标：在 24 小时内把现有系统打磨成可演示、可试用、可继续迭代的 local launch candidate。

### 第 0-2 小时：范围冻结

产出：

- 确认首发只做本地真实 repo 工作流；
- 冻结“必须有/延后功能”；
- 跑一遍现有 test/typecheck/lint/build，记录失败项；
- 选定一个干净真实 repo 作为验收样本。

工程任务：

- 不新增大架构；
- 不引入新数据库或云部署；
- 所有编码 agent 按本文件范围工作。

### 第 2-6 小时：阻塞问题修复

产出：

- 修掉阻断真实 repo workflow 的 bug；
- 确保 repository workflow payload 在 UI/API 都能稳定提交；
- 确保 workflow 状态和 artifacts 重启后可查；
- 明确 CLI agent 未配置时的显示和错误。

验收：

- 能用 shell task 在真实 repo 中跑通一次 workflow；
- report 能看到 task、gate、patch 路径。

### 第 6-10 小时：质量门与 retry 打磨

产出：

- gate 失败状态明确；
- retry 后 stale diff、gate result、review decision 被清理；
- timeout 行为有日志；
- merge candidate 只包含 passed task。

验收：

- 人为制造一个失败 gate，确认不能 approve 为成功；
- retry 后改成通过 gate，确认可生成 merge candidate。

### 第 10-14 小时：Review 与报告可用性

产出：

- report 字段顺序清楚：summary、tasks、gates、artifacts、risks、next action；
- UI 中 approve/reject/retry/merge candidate 的状态不互相打架；
- merge candidate 展示 patch 路径和 `git apply` 命令；
- 失败任务显示失败原因和 artifact 链接或路径。

验收：

- 未参与开发的人能看 report 判断是否应用 patch；
- 用户不需要翻 API 原始 JSON 才能完成下一步。

### 第 14-18 小时：启动文档与示例

产出：

- 更新或新增文档说明本地启动；
- 提供真实 repo workflow 示例 payload；
- 说明 CLI agent command template 配置；
- 说明已知限制和不要做的操作。

验收：

- 从干净终端按文档可启动 API/Web；
- 文档里的示例 payload 可直接改路径运行。

### 第 18-22 小时：端到端验收

产出：

- 跑一次成功路径；
- 跑一次 gate 失败路径；
- 跑一次 retry 后成功路径；
- 截图或记录关键输出路径，供后续 agent 追踪。

验收：

- test/typecheck/lint/build 全绿；
- 成功路径产出 merge candidate；
- 失败路径不会误导用户合并；
- retry 路径没有残留旧结果。

### 第 22-24 小时：Launch Candidate 决策

产出：

- 标注 launch-ready / not-ready；
- 列出 P0 bug；
- 列出下一个 24 小时最高优先级；
- 决定是否邀请 1-2 个真实用户试用。

决策规则：

- 只要真实 repo 成功路径、失败路径、retry 路径任一不可用，则 not-ready；
- 若 CLI agent 不稳定但 shell workflow 稳定，可以作为“shell + configurable CLI beta”上线；
- 若 report 无法指导合并判断，则 not-ready。

## 6. 风险清单

| 风险 | 影响 | 当前处理 | 上线前最低要求 |
|---|---:|---|---|
| 真实 CLI agent 命令参数不稳定 | 高 | 用 command template 配置，不硬编码供应商细节 | 未配置时明确 unavailable；配置示例写入文档 |
| Agent 修改范围过大 | 高 | worktree 隔离 + patch 聚合 | patch 展示 changed files；不自动 merge |
| Gate 误判或缺失 | 高 | 用户配置 gate command | gate 失败阻止成功结论；无 gate 时 report 标红风险 |
| 主仓库 dirty 导致 patch 不可信 | 高 | 运行前检查 | 默认提示并要求用户清理或确认 |
| 日志或 patch 过大 | 中 | artifact 文件存储 | 至少限制展示长度，文档列为已知限制 |
| API/Web 重启后状态丢失 | 高 | 本地持久化 | 重启后 workflow/report 可查 |
| Retry 混入旧结果 | 高 | retry 清理 stale data | 自动化测试覆盖 |
| 多任务 patch 冲突 | 中 | 只生成 merge candidate，不自动应用 | report 标注需用户手动 `git apply` 验证 |
| Windows 路径和空格路径问题 | 中 | 使用绝对路径和引用命令 | 示例覆盖 Windows 路径 |
| 用户误以为系统会自动规划任务 | 中 | 首发定位为手动任务输入 | UI/文档明确“不含自动拆解” |
| 安全边界不足 | 高 | local-first + worktree | 不做云端多租户；禁止自动 merge；timeout 必须有 |

## 7. 上线判定清单

Launch-ready 必须全部满足：

- [ ] 真实 repo workflow 成功路径跑通；
- [ ] gate 失败路径跑通；
- [ ] retry 后成功路径跑通；
- [ ] merge candidate 生成且可手动 `git apply`；
- [ ] API 重启后 report 可读；
- [ ] test/typecheck/lint/build 通过；
- [ ] 文档包含启动、示例 payload、CLI agent 配置、已知限制；
- [ ] UI 或 report 明确显示“不自动合并主分支”；
- [ ] P0 bug 清零。

允许带着上线的限制：

- 只支持本地运行；
- 只支持手动任务输入；
- 真实 CLI agent 需要用户自己配置 command template；
- 暂无自动 PR 创建；
- 暂无团队权限；
- 暂无自动任务拆解。

## 8. 下一步最高优先级

如果只能让一个工程 agent 继续做，最高优先级是：

> 用一个真实本地 repo 跑通“成功 -> gate 失败 -> retry 成功 -> merge candidate”的端到端验收，并把发现的 P0 问题逐个修掉。

推荐任务顺序：

1. 先跑现有自动化验证，确认基线；
2. 用 shell task 构造真实 repo 成功路径；
3. 构造失败 gate，确认失败状态和 report；
4. retry 后确认旧结果清理；
5. 检查 merge candidate patch 是否只包含通过任务；
6. 补齐缺失测试和启动文档；
7. 再接真实 Codex CLI command template。
