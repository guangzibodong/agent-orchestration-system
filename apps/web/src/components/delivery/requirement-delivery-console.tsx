import { Plus, Search, Settings, ShieldCheck } from "lucide-react";
import type { DeliveryConsoleModel } from "./delivery-console-model";
import { buildDecisionQueueDisplay, buildRequirementQueueRows } from "./requirement-queue-display";
import { buildRequirementStageStepper } from "./requirement-stage-stepper";

type RequirementDeliveryConsoleProps = {
  model: DeliveryConsoleModel;
  viewerMode?: boolean;
};

export function RequirementDeliveryConsole({
  model,
  viewerMode = false
}: RequirementDeliveryConsoleProps) {
  const queueRows = buildRequirementQueueRows(model.requirements);
  const decisionRows = buildDecisionQueueDisplay(model.decisionQueue);
  const selectedRequirement = model.requirements[0];
  const stageSteps = buildRequirementStageStepper(
    selectedRequirement?.requirementStage ?? "draft"
  );

  return (
    <main className="deliveryShell" aria-labelledby="delivery-title">
      <section className="deliveryTopbar">
        <div>
          <p className="eyebrow">Local agent safety console</p>
          <h1 id="delivery-title">Requirement Delivery Console</h1>
        </div>
        <div className="deliveryTopbarActions" aria-label="Primary actions">
          <label className="deliverySearch">
            <Search size={16} aria-hidden="true" />
            <span>Search requirements, repos, reports</span>
          </label>
          <button className="primaryButton" type="button" disabled={viewerMode}>
            <Plus size={16} aria-hidden="true" />
            New Requirement
          </button>
          <button className="secondaryButton" type="button">
            <Settings size={16} aria-hidden="true" />
            Legacy Run Console
          </button>
        </div>
      </section>

      {viewerMode ? (
        <section className="viewerModeBanner" aria-label="Viewer mode">
          <strong>Viewer mode</strong>
          <span>Write actions are disabled. Review evidence remains readable.</span>
        </section>
      ) : null}

      <section className="deliveryKpis" aria-label="Requirement delivery metrics">
        <Metric label="Active" value={model.kpis.activeRequirements} />
        <Metric label="Needs Clarification" value={model.kpis.needsClarification} />
        <Metric label="Running" value={model.kpis.runningTasks} />
        <Metric label="Failed Gates" value={model.kpis.failedGates} tone="danger" />
        <Metric label="Waiting Review" value={model.kpis.waitingForReview} />
        <Metric label="Delivered 7d" value={model.kpis.deliveredLastSevenDays} />
      </section>

      <section className="deliveryGrid" aria-label="Requirement delivery workspace">
        <aside className="deliveryPanel requirementQueuePanel">
          <div className="deliveryPanelHeader">
            <h2>Requirement Queue</h2>
            <span>{queueRows.length} active</span>
          </div>
          {queueRows.length ? (
            <div className="requirementQueueList">
              {queueRows.map((row) => (
                <article className="requirementQueueItem" key={row.id}>
                  <div>
                    <strong>{row.title}</strong>
                    <span>{row.repositoryLabel}</span>
                  </div>
                  <div className="requirementQueueMeta">
                    <span>{row.stageLabel}</span>
                    <span>{row.riskLabel}</span>
                  </div>
                  <p>{row.nextAction}</p>
                  <small>
                    {row.nodeLabel} / {row.updatedAt}
                  </small>
                </article>
              ))}
            </div>
          ) : (
            <div className="deliveryEmptyState">
              <strong>No requirements yet</strong>
              <span>
                Create a requirement to produce an isolated, quality-gated merge
                candidate.
              </span>
            </div>
          )}
        </aside>

        <section className="deliveryPanel deliveryFocusPanel">
          <div className="deliveryPanelHeader">
            <h2>{selectedRequirement?.title ?? "New requirement path"}</h2>
            <span>{selectedRequirement?.riskLevel ?? "medium"} risk</span>
          </div>

          <section className="repositorySafetyCard" aria-label="Repository Safety">
            <div>
              <ShieldCheck size={20} aria-hidden="true" />
              <strong>Repository Safety</strong>
            </div>
            <p>
              Branch, HEAD, clean/dirty state, allowed-root status, and manual
              apply policy must be visible before execution.
            </p>
            <span>No auto-merge. Patch must be manually applied with git apply.</span>
          </section>

          <section aria-label="Stage Stepper">
            <div className="deliveryPanelHeader compact">
              <h2>Stage Stepper</h2>
              <span>{selectedRequirement?.nextAction ?? "Complete requirement"}</span>
            </div>
            <ol className="stageStepper">
              {stageSteps.map((step) => (
                <li className={`stageStep ${step.state}`} key={step.id}>
                  <span>{step.label}</span>
                  {step.reason ? <small>{step.reason}</small> : null}
                </li>
              ))}
            </ol>
          </section>
        </section>

        <aside className="deliveryPanel decisionQueuePanel">
          <div className="deliveryPanelHeader">
            <h2>Decision Queue</h2>
            <span>{decisionRows.length} waiting</span>
          </div>
          {decisionRows.length ? (
            <div className="decisionQueueList">
              {decisionRows.map((decision) => (
                <article className={`decisionItem ${decision.tone}`} key={decision.id}>
                  <span>{decision.severityLabel}</span>
                  <strong>{decision.title}</strong>
                  <p>{decision.actionLabel}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="deliveryEmptyState">
              <strong>No decisions waiting</strong>
              <span>
                Requirements that need review, retry, clarification, or safety
                action will appear here.
              </span>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone?: "danger";
}) {
  return (
    <div className={`deliveryMetric ${tone ?? ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
