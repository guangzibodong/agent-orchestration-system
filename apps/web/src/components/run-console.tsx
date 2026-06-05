"use client";

import {
  Activity,
  Bot,
  CheckCircle2,
  FolderGit2,
  GitBranch,
  Play,
  Plus,
  RotateCcw,
  Square,
  ShieldCheck,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  agentSummarySchema,
  agentHealthSchema,
  mergeCandidateSchema,
  repositoryRecordSchema,
  runReportSchema,
  workflowJobSchema,
  workflowRunSchema,
  type AuditEvent,
  type AgentHealth,
  type AgentSummary,
  type MergeCandidate,
  type RepositoryRecord,
  type RunReport,
  type WorkflowJob,
  type WorkflowRun
} from "@mawo/shared";
import { buildMergeCandidateDisplay } from "@/components/merge-candidate-display";
import {
  buildRepositoryWorkflowPayload,
  canCreateRepositoryWorkflow,
  type RepositoryWorkflowFormState
} from "@/components/repository-workflow-payload";
import {
  buildRepositoryDisplay,
  summarizeRepositories
} from "@/components/repository-display";
import { buildWorkflowReviewPayload } from "@/components/workflow-review-payload";
import { WorkflowCanvas } from "@/components/workflow-canvas";
import { buildApiHeaders } from "@/components/api-auth";
import {
  buildAgentHealthDisplay,
  summarizeAgentHealth
} from "@/components/agent-health-display";
import {
  buildAuditEventDisplay,
  summarizeAuditEvents
} from "@/components/audit-event-display";
import {
  buildJobHistoryDisplay,
  summarizeJobHistory
} from "@/components/job-history-display";
import { loadOperationsSnapshot } from "@/components/operations-snapshot";
import {
  buildWorkflowListDisplay,
  summarizeWorkflowList
} from "@/components/workflow-list-display";
import {
  canCancelJobStatus,
  canCleanupWorkflowStatus,
  canRetryWorkflowStatus,
  formatJobStatus,
  parseWorkflowAlreadyRunningJob,
  type WorkflowJobDisplayStatus
} from "@/components/workflow-actions";
import { cleanupWorkflowWorkspaces } from "@/components/workflow-workspaces";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
const apiTokenStorageKey = "mawo-api-token";
const defaultRepositoryForm: RepositoryWorkflowFormState = {
  goal: "Run a real repository workflow",
  repositoryPath: process.env.NEXT_PUBLIC_REPOSITORY_PATH ?? "",
  agent: "shell",
  taskCommand: "git status --short",
  taskTimeoutMs: "900000",
  qualityGateCommand: "",
  qualityGateTimeoutMs: "300000"
};

type ConsoleWorkflowJob = Omit<WorkflowJob, "status"> & {
  status: WorkflowJobDisplayStatus;
};

class ApiResponseError extends Error {
  readonly body: unknown;
  readonly status: number;

  constructor(status: number, path: string, body: unknown) {
    super(`API ${status}: ${path}`);
    this.name = "ApiResponseError";
    this.body = body;
    this.status = status;
  }
}

function getStoredApiToken(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage.getItem(apiTokenStorageKey) ?? undefined;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: buildApiHeaders(getStoredApiToken(), init?.headers)
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    throw new ApiResponseError(response.status, path, body);
  }

  return body as T;
}

export function RunConsole() {
  const [workflow, setWorkflow] = useState<WorkflowRun>();
  const [workflowList, setWorkflowList] = useState<WorkflowRun[]>([]);
  const [report, setReport] = useState<RunReport>();
  const [job, setJob] = useState<ConsoleWorkflowJob>();
  const [mergeCandidate, setMergeCandidate] = useState<MergeCandidate>();
  const [repositoryForm, setRepositoryForm] = useState(defaultRepositoryForm);
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [configuredAgents, setConfiguredAgents] = useState<AgentSummary[]>([]);
  const [agentHealth, setAgentHealth] = useState<AgentHealth[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [jobHistory, setJobHistory] = useState<WorkflowJob[]>([]);
  const [apiToken, setApiToken] = useState(() => getStoredApiToken() ?? "");
  const [isBusy, setIsBusy] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [error, setError] = useState<string>();

  const agentHealthSummary = useMemo(
    () => summarizeAgentHealth(agentHealth),
    [agentHealth]
  );
  const agentHealthDisplay = useMemo(
    () => buildAgentHealthDisplay(agentHealth),
    [agentHealth]
  );
  const repositorySummary = useMemo(
    () => summarizeRepositories(repositories),
    [repositories]
  );
  const repositoryDisplay = useMemo(
    () => buildRepositoryDisplay(repositories),
    [repositories]
  );
  const auditEventSummary = useMemo(
    () => summarizeAuditEvents(auditEvents),
    [auditEvents]
  );
  const auditEventDisplay = useMemo(
    () => buildAuditEventDisplay(auditEvents).slice(0, 8),
    [auditEvents]
  );
  const jobHistorySummary = useMemo(
    () => summarizeJobHistory(jobHistory),
    [jobHistory]
  );
  const jobHistoryDisplay = useMemo(
    () => buildJobHistoryDisplay(jobHistory).slice(0, 8),
    [jobHistory]
  );
  const workflowListSummary = useMemo(
    () => summarizeWorkflowList(workflowList),
    [workflowList]
  );
  const workflowListDisplay = useMemo(
    () => buildWorkflowListDisplay(workflowList).slice(-8).reverse(),
    [workflowList]
  );

  const metrics = useMemo(
    () => [
      {
        label: "Workflows",
        value: String(workflowListSummary.total),
        icon: GitBranch
      },
      {
        label: "Repositories",
        value: String(repositorySummary.total),
        icon: FolderGit2
      },
      {
        label: "Agents",
        value:
          agentHealthSummary.total > 0
            ? `${agentHealthSummary.healthy}/${agentHealthSummary.total}`
            : String(
                new Set(workflow?.tasks.map((task) => task.agent)).size || 0
              ),
        icon: Activity
      },
      {
        label: "Workflow Nodes",
        value: String(
          (workflow?.tasks.length ?? 0) + (workflow?.qualityGates.length ?? 0)
        ),
        icon: GitBranch
      },
      {
        label: "Quality Gates",
        value: String(workflow?.qualityGates.length ?? 0),
        icon: ShieldCheck
      },
      {
        label: "Audit Events",
        value: String(auditEventSummary.total),
        icon: Activity
      },
      {
        label: "Jobs",
        value: String(jobHistorySummary.total),
        icon: Play
      }
    ],
    [
      agentHealthSummary,
      auditEventSummary,
      jobHistorySummary,
      repositorySummary,
      workflow,
      workflowListSummary
    ]
  );
  const canCreateRepositoryRun = useMemo(
    () => canCreateRepositoryWorkflow(repositoryForm),
    [repositoryForm]
  );
  const agentOptions = useMemo(
    () => [{ id: "shell", label: "Shell" }, ...configuredAgents],
    [configuredAgents]
  );
  const canRetryCurrentWorkflow = canRetryWorkflowStatus(workflow?.status);
  const canCleanupCurrentWorkflow = canCleanupWorkflowStatus(workflow?.status);
  const canCancelCurrentJob = canCancelJobStatus(job?.status);

  const updateApiToken = useCallback((value: string) => {
    setApiToken(value);
    if (value.trim()) {
      window.localStorage.setItem(apiTokenStorageKey, value.trim());
      return;
    }

    window.localStorage.removeItem(apiTokenStorageKey);
  }, []);

  const updateRepositoryForm = useCallback(
    (field: keyof RepositoryWorkflowFormState, value: string) => {
      setRepositoryForm((current) => ({
        ...current,
        [field]: value
      }));
    },
    []
  );

  const selectRegisteredRepository = useCallback((repositoryPath: string) => {
    setRepositoryForm((current) => ({
      ...current,
      repositoryPath
    }));
  }, []);

  const loadWorkflowList = useCallback(async () => {
    const workflows = await api<unknown[]>("/workflows");
    const parsed = workflows.map((item) => workflowRunSchema.parse(item));
    setWorkflowList(parsed);
    return parsed;
  }, []);

  const createDemo = useCallback(async () => {
    setIsBusy(true);
    setError(undefined);
    setReport(undefined);
    setJob(undefined);
    setMergeCandidate(undefined);

    try {
      const next = await api<unknown>("/workflows/demo", {
        method: "POST",
        body: "{}"
      });
      setWorkflow(workflowRunSchema.parse(next));
      await loadWorkflowList();
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Create failed");
    } finally {
      setIsBusy(false);
    }
  }, [loadWorkflowList]);

  const createWorktreeDemo = useCallback(async () => {
    setIsBusy(true);
    setError(undefined);
    setReport(undefined);
    setJob(undefined);
    setMergeCandidate(undefined);

    try {
      const next = await api<unknown>("/workflows/worktree-demo", {
        method: "POST",
        body: "{}"
      });
      setWorkflow(workflowRunSchema.parse(next));
      await loadWorkflowList();
    } catch (apiError) {
      setError(
        apiError instanceof Error ? apiError.message : "Create worktree run failed"
      );
    } finally {
      setIsBusy(false);
    }
  }, [loadWorkflowList]);

  const createAgentDemo = useCallback(async () => {
    setIsBusy(true);
    setError(undefined);
    setReport(undefined);
    setJob(undefined);
    setMergeCandidate(undefined);

    try {
      const next = await api<unknown>("/workflows/agent-demo", {
        method: "POST",
        body: "{}"
      });
      setWorkflow(workflowRunSchema.parse(next));
      await loadWorkflowList();
    } catch (apiError) {
      setError(
        apiError instanceof Error ? apiError.message : "Create agent run failed"
      );
    } finally {
      setIsBusy(false);
    }
  }, [loadWorkflowList]);

  const createRepositoryWorkflow = useCallback(async () => {
    setIsBusy(true);
    setError(undefined);
    setReport(undefined);
    setJob(undefined);
    setMergeCandidate(undefined);

    try {
      const payload = buildRepositoryWorkflowPayload(repositoryForm);
      const next = await api<unknown>("/workflows/repository", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setWorkflow(workflowRunSchema.parse(next));
      await loadWorkflowList();
    } catch (apiError) {
      setError(
        apiError instanceof Error
          ? apiError.message
          : "Create repository run failed"
      );
    } finally {
      setIsBusy(false);
    }
  }, [loadWorkflowList, repositoryForm]);

  const loadLatestWorkflow = useCallback(async () => {
    const parsed = await loadWorkflowList();
    if (parsed.length > 0) {
      setWorkflow(parsed.at(-1));
      return;
    }

    await createDemo();
  }, [createDemo, loadWorkflowList]);

  const openWorkflow = useCallback(async (workflowId: string) => {
    setIsBusy(true);
    setError(undefined);
    setReport(undefined);
    setJob(undefined);
    setMergeCandidate(undefined);

    try {
      const next = await api<unknown>(`/workflows/${workflowId}`);
      setWorkflow(workflowRunSchema.parse(next));
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Load workflow failed");
    } finally {
      setIsBusy(false);
    }
  }, []);

  const loadConfiguredAgents = useCallback(async () => {
    const agents = await api<unknown[]>("/agents");
    setConfiguredAgents(agents.map((agent) => agentSummarySchema.parse(agent)));
  }, []);

  const loadRepositories = useCallback(async () => {
    const records = await api<unknown[]>("/repositories");
    setRepositories(records.map((record) => repositoryRecordSchema.parse(record)));
  }, []);

  const loadAgentHealth = useCallback(async () => {
    const health = await api<unknown[]>("/agents/health");
    setAgentHealth(health.map((agent) => agentHealthSchema.parse(agent)));
  }, []);

  const refreshOperationsSnapshot = useCallback(async () => {
    const snapshot = await loadOperationsSnapshot(api);
    setAuditEvents(snapshot.auditEvents);
    setJobHistory(snapshot.jobs);
  }, []);

  const loadMergeCandidate = useCallback(async (workflowId: string) => {
    const candidate = await api<unknown>(
      `/workflows/${workflowId}/merge-candidate`
    );
    setMergeCandidate(mergeCandidateSchema.parse(candidate));
  }, []);

  const refreshJobAndWorkflow = useCallback(
    async (jobId: string, workflowId: string) => {
      const [nextJob, nextWorkflow] = await Promise.all([
        api<unknown>(`/jobs/${jobId}`),
        api<unknown>(`/workflows/${workflowId}`)
      ]);
      setJob(parseWorkflowJob(nextJob));
      setWorkflow(workflowRunSchema.parse(nextWorkflow));
    },
    []
  );

  const runWorkflow = useCallback(async () => {
    if (!workflow) {
      return;
    }

    setIsBusy(true);
    setError(undefined);
    setJob(undefined);

    try {
      let queuedJob: ConsoleWorkflowJob;

      try {
        const queued = await api<unknown>(`/workflows/${workflow.id}/enqueue`, {
          method: "POST",
          body: "{}"
        });
        queuedJob = parseWorkflowJob(queued);
      } catch (apiError) {
        const activeJob =
          apiError instanceof ApiResponseError
            ? parseWorkflowAlreadyRunningJob(apiError.body)
            : undefined;

        if (!activeJob) {
          throw apiError;
        }

        queuedJob = parseWorkflowJob(activeJob);
      }

      setJob(queuedJob);

      for (let attempt = 0; attempt < 80; attempt++) {
        await delay(250);
        const nextJob = parseWorkflowJob(
          await api<unknown>(`/jobs/${queuedJob.id}`)
        );
        setJob(nextJob);
        const nextWorkflow = workflowRunSchema.parse(
          await api<unknown>(`/workflows/${workflow.id}`)
        );
        setWorkflow(nextWorkflow);

        if (
          nextJob.status === "completed" ||
          nextJob.status === "failed" ||
          nextJob.status === "canceled"
        ) {
          if (nextJob.status !== "canceled") {
            const nextReport = await api<unknown>(
              `/workflows/${workflow.id}/report`
            );
            setReport(runReportSchema.parse(nextReport));
            await loadMergeCandidate(workflow.id);
          }
          await loadWorkflowList();
          await refreshOperationsSnapshot();
          break;
        }
      }
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Run failed");
    } finally {
      setIsBusy(false);
    }
  }, [loadMergeCandidate, loadWorkflowList, refreshOperationsSnapshot, workflow]);

  const cancelJob = useCallback(async () => {
    if (!job || !workflow || !canCancelJobStatus(job.status)) {
      return;
    }

    setIsCanceling(true);
    setError(undefined);

    try {
      await api<unknown>(`/jobs/${job.id}/cancel`, {
        method: "POST",
        body: "{}"
      });
      await refreshJobAndWorkflow(job.id, workflow.id);
      await loadWorkflowList();
      await refreshOperationsSnapshot();
    } catch (apiError) {
      setError(
        apiError instanceof Error
          ? `Cancel failed: ${apiError.message}`
          : "Cancel failed"
      );
      await refreshJobAndWorkflow(job.id, workflow.id).catch(() => undefined);
    } finally {
      setIsCanceling(false);
    }
  }, [
    job,
    loadWorkflowList,
    refreshJobAndWorkflow,
    refreshOperationsSnapshot,
    workflow
  ]);

  const retryWorkflow = useCallback(async () => {
    if (!workflow || !canRetryWorkflowStatus(workflow.status)) {
      return;
    }

    setIsBusy(true);
    setError(undefined);
    setReport(undefined);
    setJob(undefined);
    setMergeCandidate(undefined);

    try {
      const retried = await api<unknown>(`/workflows/${workflow.id}/retry`, {
        method: "POST",
        body: "{}"
      });
      setWorkflow(workflowRunSchema.parse(retried));
      await loadWorkflowList();
      await refreshOperationsSnapshot();
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Retry failed");
    } finally {
      setIsBusy(false);
    }
  }, [loadWorkflowList, refreshOperationsSnapshot, workflow]);

  const reviewWorkflow = useCallback(
    async (decision: "approve" | "reject") => {
      if (!workflow) {
        return;
      }

      setIsBusy(true);
      setError(undefined);

      try {
        const reviewed = await api<unknown>(`/workflows/${workflow.id}/review`, {
          method: "POST",
          body: JSON.stringify(buildWorkflowReviewPayload(decision))
        });
        setWorkflow(workflowRunSchema.parse(reviewed));
        await loadWorkflowList();
        if (decision === "approve") {
          await loadMergeCandidate(workflow.id);
        }
        await refreshOperationsSnapshot();
      } catch (apiError) {
        setError(apiError instanceof Error ? apiError.message : "Review failed");
      } finally {
        setIsBusy(false);
      }
    },
    [loadMergeCandidate, loadWorkflowList, refreshOperationsSnapshot, workflow]
  );

  const cleanupWorkspaces = useCallback(async () => {
    if (!workflow || !canCleanupWorkflowStatus(workflow.status)) {
      return;
    }

    setIsBusy(true);
    setError(undefined);

    try {
      const refreshed = await cleanupWorkflowWorkspaces(api, workflow);
      setWorkflow(refreshed);
      await loadWorkflowList();
      await refreshOperationsSnapshot();
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Cleanup failed");
    } finally {
      setIsBusy(false);
    }
  }, [loadWorkflowList, refreshOperationsSnapshot, workflow]);

  useEffect(() => {
    // Load the API-backed in-memory run after the browser can reach the API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLatestWorkflow().catch((apiError) => {
      setError(apiError instanceof Error ? apiError.message : "Load failed");
    });
    loadConfiguredAgents().catch((apiError) => {
      setError(apiError instanceof Error ? apiError.message : "Load agents failed");
    });
    loadRepositories().catch((apiError) => {
      setError(
        apiError instanceof Error ? apiError.message : "Load repositories failed"
      );
    });
    refreshOperationsSnapshot().catch((apiError) => {
      setError(
        apiError instanceof Error
          ? apiError.message
          : "Load operations snapshot failed"
      );
    });
    loadAgentHealth().catch((apiError) => {
      setError(
        apiError instanceof Error ? apiError.message : "Load agent health failed"
      );
    });
  }, [
    loadAgentHealth,
    loadConfiguredAgents,
    loadLatestWorkflow,
    loadWorkflowList,
    loadRepositories,
    refreshOperationsSnapshot
  ]);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">MAWO</p>
          <h1>多 Agent 编排平台</h1>
        </div>
        <nav className="nav">
          <button className="navItem active">Run Console</button>
          <button className="navItem">Workflows</button>
          <button className="navItem">Agents</button>
          <button className="navItem">Quality Gates</button>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">v0.1 Local Runner</p>
            <h2>{workflow?.goal ?? "Local workflow"}</h2>
          </div>
          <div className="actions">
            <label className="tokenField">
              <ShieldCheck aria-hidden="true" size={16} />
              <input
                autoComplete="off"
                placeholder="API token"
                type="password"
                value={apiToken}
                onChange={(event) => updateApiToken(event.target.value)}
              />
            </label>
            <button className="secondaryButton" disabled={isBusy} onClick={createDemo}>
              <Plus aria-hidden="true" size={16} />
              Shell Run
            </button>
            <button
              className="secondaryButton"
              disabled={isBusy}
              onClick={createWorktreeDemo}
            >
              <GitBranch aria-hidden="true" size={16} />
              Worktree Run
            </button>
            <button
              className="secondaryButton"
              disabled={isBusy}
              onClick={createAgentDemo}
            >
              <Bot aria-hidden="true" size={16} />
              Agent Run
            </button>
            <button
              className="primaryButton"
              disabled={isBusy || !workflow}
              onClick={runWorkflow}
            >
              <Play aria-hidden="true" size={16} />
              Run Workflow
            </button>
            <button
              className="secondaryButton"
              disabled={isBusy || !canRetryCurrentWorkflow}
              onClick={retryWorkflow}
            >
              <RotateCcw aria-hidden="true" size={16} />
              Retry
            </button>
          </div>
        </header>

        <div className="metrics">
          {metrics.map((metric) => (
            <div className="metric" key={metric.label}>
              <metric.icon aria-hidden="true" size={18} />
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>

        <form
          className="repositoryPanel"
          onSubmit={(event) => {
            event.preventDefault();
            void createRepositoryWorkflow();
          }}
        >
          <label className="field wide">
            <span>Repository Path</span>
            <input
              value={repositoryForm.repositoryPath}
              onChange={(event) =>
                updateRepositoryForm("repositoryPath", event.target.value)
              }
            />
          </label>
          <label className="field">
            <span>Goal</span>
            <input
              value={repositoryForm.goal}
              onChange={(event) => updateRepositoryForm("goal", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Agent</span>
            <select
              value={repositoryForm.agent}
              onChange={(event) => updateRepositoryForm("agent", event.target.value)}
            >
              {agentOptions.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Task Command</span>
            <textarea
              rows={2}
              value={repositoryForm.taskCommand}
              onChange={(event) =>
                updateRepositoryForm("taskCommand", event.target.value)
              }
            />
          </label>
          <label className="field compact">
            <span>Task Timeout</span>
            <input
              inputMode="numeric"
              value={repositoryForm.taskTimeoutMs}
              onChange={(event) =>
                updateRepositoryForm("taskTimeoutMs", event.target.value)
              }
            />
          </label>
          <label className="field">
            <span>Quality Gate</span>
            <textarea
              rows={2}
              value={repositoryForm.qualityGateCommand}
              onChange={(event) =>
                updateRepositoryForm("qualityGateCommand", event.target.value)
              }
            />
          </label>
          <label className="field compact">
            <span>Gate Timeout</span>
            <input
              inputMode="numeric"
              value={repositoryForm.qualityGateTimeoutMs}
              onChange={(event) =>
                updateRepositoryForm("qualityGateTimeoutMs", event.target.value)
              }
            />
          </label>
          <button
            className="secondaryButton"
            disabled={isBusy || !canCreateRepositoryRun}
            type="submit"
          >
            <FolderGit2 aria-hidden="true" size={16} />
            Repository Run
          </button>
        </form>

        <section className="repositoryRegistry">
          <div className="sectionHeader">
            <h3>Repositories</h3>
            <span>
              {repositorySummary.withQualityGates}/{repositorySummary.total} gated
            </span>
          </div>
          <div className="repositoryList">
            {repositoryDisplay.map((repository) => (
              <article className="repositoryItem" key={repository.id}>
                <div>
                  <strong>{repository.name}</strong>
                  <span>{repository.defaultBranch}</span>
                </div>
                <p>{repository.path}</p>
                <dl className="artifactMeta">
                  <div>
                    <dt>Quality Gates</dt>
                    <dd>{repository.qualityGateLabel}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{repository.updatedAt}</dd>
                  </div>
                </dl>
                <button
                  className="secondaryButton"
                  onClick={() => selectRegisteredRepository(repository.path)}
                  type="button"
                >
                  <FolderGit2 aria-hidden="true" size={16} />
                  Use
                </button>
              </article>
            ))}
            {repositoryDisplay.length === 0 ? (
              <div className="reportBox muted">No repositories registered</div>
            ) : null}
          </div>
        </section>

        {error ? <p className="errorText">{error}</p> : null}
        {job ? (
          <div className={`jobBanner ${job.status}`}>
            <div className="jobBannerMain">
              <span>Job {job.id.slice(0, 8)}</span>
              <strong>{formatJobStatus(job.status)}</strong>
            </div>
            {job.error ? <p>{job.error}</p> : null}
            {canCancelCurrentJob ? (
              <button
                className="secondaryButton"
                disabled={isCanceling}
                onClick={() => void cancelJob()}
                type="button"
              >
                <Square aria-hidden="true" size={15} />
                {isCanceling ? "Canceling" : "Cancel"}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="consoleGrid">
          <WorkflowCanvas workflow={workflow} />
          <aside className="inspector">
            <div className={`statusPill ${workflow?.status ?? "draft"}`}>
              {workflow?.status ?? "draft"}
            </div>

            <section className="inspectorSection">
              <div className="sectionHeader">
                <h3>Workflows</h3>
                <span>
                  {workflowListSummary.active} active /{" "}
                  {workflowListSummary.needsReview} review
                </span>
              </div>
              <div className="runList">
                {workflowListDisplay.map((item) => (
                  <article className="workflowHistoryItem" key={item.id}>
                    <div>
                      <strong>{item.goal}</strong>
                      <span className={`statusPill ${item.status}`}>
                        {item.status}
                      </span>
                    </div>
                    <p>{item.repositoryLabel}</p>
                    <dl className="artifactMeta">
                      <div>
                        <dt>Workflow</dt>
                        <dd>{item.workflowLabel}</dd>
                      </div>
                      <div>
                        <dt>Nodes</dt>
                        <dd>{item.nodeLabel}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{item.updatedAt}</dd>
                      </div>
                    </dl>
                    <button
                      className="secondaryButton"
                      disabled={isBusy || workflow?.id === item.id}
                      onClick={() => void openWorkflow(item.id)}
                      type="button"
                    >
                      <GitBranch aria-hidden="true" size={16} />
                      Open
                    </button>
                  </article>
                ))}
                {workflowListDisplay.length === 0 ? (
                  <div className="reportBox muted">No workflows</div>
                ) : null}
              </div>
            </section>

            <section className="inspectorSection">
              <div className="sectionHeader">
                <h3>Agents</h3>
                <span>
                  {agentHealthSummary.needsAttention > 0
                    ? `${agentHealthSummary.needsAttention} need attention`
                    : "Ready"}
                </span>
              </div>
              <div className="runList">
                {agentHealthDisplay.map((agent) => (
                  <article className="agentHealthItem" key={agent.id}>
                    <div>
                      <strong>{agent.label}</strong>
                      <span className={`healthBadge ${agent.severity}`}>
                        {agent.statusLabel}
                      </span>
                    </div>
                    <p>{agent.message}</p>
                    {agent.command ? (
                      <dl className="artifactMeta">
                        <div>
                          <dt>Command</dt>
                          <dd>{agent.command}</dd>
                        </div>
                        <div>
                          <dt>Checked</dt>
                          <dd>{agent.checkedAt}</dd>
                        </div>
                      </dl>
                    ) : null}
                  </article>
                ))}
                {agentHealthDisplay.length === 0 ? (
                  <div className="reportBox muted">No agent health checks</div>
                ) : null}
              </div>
            </section>

            <section className="inspectorSection">
              <div className="sectionHeader">
                <h3>Audit</h3>
                <span>{auditEventSummary.operatorActions} operator actions</span>
              </div>
              <div className="runList">
                {auditEventDisplay.map((event) => (
                  <article className="auditEventItem" key={event.id}>
                    <div>
                      <strong>{event.label}</strong>
                      <span>{event.actor}</span>
                    </div>
                    <p>{event.createdAt}</p>
                    <dl className="artifactMeta">
                      {event.workflowLabel ? (
                        <div>
                          <dt>Workflow</dt>
                          <dd>{event.workflowLabel}</dd>
                        </div>
                      ) : null}
                      {event.jobLabel ? (
                        <div>
                          <dt>Job</dt>
                          <dd>{event.jobLabel}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Metadata</dt>
                        <dd>{event.metadataLabel}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
                {auditEventDisplay.length === 0 ? (
                  <div className="reportBox muted">No audit events</div>
                ) : null}
              </div>
            </section>

            <section className="inspectorSection">
              <div className="sectionHeader">
                <h3>Jobs</h3>
                <span>
                  {jobHistorySummary.active} active / {jobHistorySummary.failed} failed
                </span>
              </div>
              <div className="runList">
                {jobHistoryDisplay.map((historyJob) => (
                  <article className="jobHistoryItem" key={historyJob.id}>
                    <div>
                      <strong>{historyJob.jobLabel}</strong>
                      <span className={`healthBadge ${historyJob.severity}`}>
                        {historyJob.statusLabel}
                      </span>
                    </div>
                    <dl className="artifactMeta">
                      <div>
                        <dt>Workflow</dt>
                        <dd>{historyJob.workflowLabel}</dd>
                      </div>
                      <div>
                        <dt>Duration</dt>
                        <dd>{historyJob.durationLabel}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{historyJob.updatedAt}</dd>
                      </div>
                    </dl>
                    {historyJob.errorLabel ? <p>{historyJob.errorLabel}</p> : null}
                  </article>
                ))}
                {jobHistoryDisplay.length === 0 ? (
                  <div className="reportBox muted">No job history</div>
                ) : null}
              </div>
            </section>

            <section className="inspectorSection">
              <h3>Tasks</h3>
              <div className="runList">
                {workflow?.tasks.map((task) => (
                  <article className="runItem" key={task.id}>
                    <strong>{task.title}</strong>
                    <span>{task.status}</span>
                    {task.workspace ? (
                      <dl className="artifactMeta">
                        {task.result?.metadata?.agentId ? (
                          <div>
                            <dt>Agent</dt>
                            <dd>
                              {task.result.metadata.agentLabel ??
                                task.result.metadata.agentId}
                            </dd>
                          </div>
                        ) : null}
                        {task.result?.metadata?.promptFile ? (
                          <div>
                            <dt>Prompt File</dt>
                            <dd>{task.result.metadata.promptFile}</dd>
                          </div>
                        ) : null}
                        <div>
                          <dt>Branch</dt>
                          <dd>{task.workspace.branch}</dd>
                        </div>
                        <div>
                          <dt>Workspace</dt>
                          <dd>{task.workspace.path}</dd>
                        </div>
                      </dl>
                    ) : null}
                    {task.result?.stdout ? <pre>{task.result.stdout}</pre> : null}
                    {task.result?.stderr ? <pre>{task.result.stderr}</pre> : null}
                    {task.diff?.status ? (
                      <pre className="patchBox">{task.diff.status}</pre>
                    ) : null}
                    {task.diff?.patch ? (
                      <pre className="patchBox">{task.diff.patch}</pre>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="inspectorSection">
              <h3>Quality Gates</h3>
              <div className="runList">
                {workflow?.qualityGates.map((gate) => (
                  <article className="runItem" key={gate.id}>
                    <strong>{gate.title}</strong>
                    <span>{gate.status}</span>
                    {gate.result?.stdout ? <pre>{gate.result.stdout}</pre> : null}
                    {gate.result?.stderr ? <pre>{gate.result.stderr}</pre> : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="inspectorSection">
              <h3>Report</h3>
              {report ? (
                <div className="reportBox">
                  <strong>{report.recommendation}</strong>
                  <p>{report.summary}</p>
                  {report.reportArtifactPath ? (
                    <p>{report.reportArtifactPath}</p>
                  ) : null}
                  {workflow?.status === "needs_review" ? (
                    <div className="reviewActions">
                      <button
                        className="primaryButton"
                        disabled={isBusy}
                        onClick={() => void reviewWorkflow("approve")}
                        type="button"
                      >
                        <CheckCircle2 aria-hidden="true" size={16} />
                        Approve
                      </button>
                      <button
                        className="secondaryButton"
                        disabled={isBusy}
                        onClick={() => void reviewWorkflow("reject")}
                        type="button"
                      >
                        <XCircle aria-hidden="true" size={16} />
                        Reject
                      </button>
                    </div>
                  ) : null}
                  {workflow?.review ? (
                    <p>
                      {workflow.review.decision} / {workflow.review.reviewedAt}
                    </p>
                  ) : null}
                  {canCleanupCurrentWorkflow ? (
                    <button
                      className="secondaryButton"
                      disabled={isBusy}
                      onClick={() => void cleanupWorkspaces()}
                      type="button"
                    >
                      <FolderGit2 aria-hidden="true" size={16} />
                      Clean Workspaces
                    </button>
                  ) : null}
                  {mergeCandidate ? (
                    <div className="mergeCandidateBox">
                      {buildMergeCandidateDisplay(mergeCandidate).lines.map(
                        (line) => (
                          <p key={line}>{line}</p>
                        )
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="reportBox muted">No report</div>
              )}
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseWorkflowJob(value: unknown): ConsoleWorkflowJob {
  if (isCanceledWorkflowJob(value)) {
    return value;
  }

  return workflowJobSchema.parse(value);
}

function isCanceledWorkflowJob(value: unknown): value is ConsoleWorkflowJob {
  if (!value || typeof value !== "object") {
    return false;
  }

  const job = value as Partial<Record<keyof ConsoleWorkflowJob, unknown>>;
  return (
    job.status === "canceled" &&
    typeof job.id === "string" &&
    typeof job.workflowId === "string" &&
    typeof job.createdAt === "string" &&
    typeof job.updatedAt === "string" &&
    (job.startedAt === undefined || typeof job.startedAt === "string") &&
    (job.finishedAt === undefined || typeof job.finishedAt === "string") &&
    (job.error === undefined || typeof job.error === "string")
  );
}
