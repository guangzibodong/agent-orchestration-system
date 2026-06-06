"use client";

import { Send, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  newRequirementDraftFromFormData,
  submitNewRequirementDraft,
  type NewRequirementPayload,
} from "./new-requirement-payload";

type NewRequirementPanelProps = {
  viewerMode?: boolean;
  onCancel?: () => void;
  onSubmit?: (payload: NewRequirementPayload) => void;
};

const taskSlots = [1, 2, 3, 4, 5];
const gateSlots = [1, 2, 3];
const defaultGateCommands = ["delivery vitest", "web typecheck", ""];

export function NewRequirementPanel({
  viewerMode = false,
  onCancel,
  onSubmit,
}: NewRequirementPanelProps) {
  const [errors, setErrors] = useState<string[]>([]);
  const [submittedTitle, setSubmittedTitle] = useState<string>();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (viewerMode) {
      setErrors(["Viewer mode prevents creating requirements."]);
      return;
    }

    const result = submitNewRequirementDraft(
      newRequirementDraftFromFormData(new FormData(event.currentTarget)),
      (payload) => {
        onSubmit?.(payload);
        setSubmittedTitle(payload.title);
      },
    );

    if (!result.ok) {
      setSubmittedTitle(undefined);
      setErrors(result.errors);
      return;
    }

    setErrors([]);
  }

  return (
    <section
      className="newRequirementPanel"
      id="new-requirement-panel"
      aria-label="New Requirement panel"
    >
      <div className="newRequirementPanelHeader">
        <div>
          <p className="eyebrow">Requirement ticket</p>
          <h2>New Requirement</h2>
        </div>
        <button
          className="secondaryButton"
          type="button"
          onClick={onCancel}
          aria-label="Close New Requirement panel"
        >
          <X size={16} aria-hidden="true" />
          Close
        </button>
      </div>

      {viewerMode ? (
        <p className="newRequirementHint">
          Viewer mode can inspect this flow, but cannot create or mutate
          requirement tickets.
        </p>
      ) : null}

      <form className="newRequirementForm" onSubmit={handleSubmit}>
        <div className="newRequirementFormGrid">
          <label className="field">
            <span>Title</span>
            <input
              name="title"
              placeholder="Short requirement title"
              required
              disabled={viewerMode}
            />
          </label>

          <label className="field">
            <span>Risk level</span>
            <select name="riskLevel" defaultValue="medium" disabled={viewerMode}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>

        <fieldset className="newRequirementFieldset">
          <legend>Repository</legend>
          <p className="newRequirementHint">
            Repository path or registered ID. Use a local path now, or paste the
            registry ID when one already exists.
          </p>
          <div className="newRequirementFormGrid">
            <label className="field">
              <span>Repository path</span>
              <input
                name="repositoryPath"
                placeholder="C:/work/real-repo"
                disabled={viewerMode}
              />
            </label>
            <label className="field">
              <span>Repository ID</span>
              <input
                name="repositoryId"
                placeholder="registered repository ID"
                disabled={viewerMode}
              />
            </label>
          </div>
        </fieldset>

        <label className="field">
          <span>Goal</span>
          <textarea
            name="goal"
            placeholder="What should this requirement accomplish?"
            required
            rows={3}
            disabled={viewerMode}
          />
        </label>

        <div className="newRequirementFormGrid">
          <label className="field">
            <span>Acceptance criteria</span>
            <textarea
              name="acceptanceCriteria"
              placeholder="One criterion per line"
              required
              rows={5}
              disabled={viewerMode}
            />
          </label>

          <label className="field">
            <span>Context paths</span>
            <textarea
              name="contextPaths"
              placeholder="Files or folders that matter, one per line"
              rows={5}
              disabled={viewerMode}
            />
          </label>
        </div>

        <div className="newRequirementFormGrid">
          <label className="field">
            <span>Constraints</span>
            <textarea
              name="constraints"
              placeholder="Boundaries the work must respect"
              rows={4}
              disabled={viewerMode}
            />
          </label>

          <label className="field">
            <span>Non-goals</span>
            <textarea
              name="nonGoals"
              placeholder="What should stay out of scope"
              rows={4}
              disabled={viewerMode}
            />
          </label>
        </div>

        <fieldset className="newRequirementFieldset">
          <legend>Tasks</legend>
          <p className="newRequirementHint">
            Add 1-5 tasks with an execution adapter, command or instructions,
            and optional dependency links.
          </p>
          <div className="newRequirementTasks">
            {taskSlots.map((slot) => (
              <section
                aria-label={`Task ${slot} contract`}
                className="newRequirementTaskCard"
                key={slot}
              >
                <div className="newRequirementTaskHeader">
                  <strong>Task {slot}</strong>
                  <span>{slot === 1 ? "required" : "optional"}</span>
                </div>
                <div className="newRequirementTaskGrid">
                  <label className="field">
                    <span>Task {slot} title</span>
                    <input
                      name="taskTitle"
                      placeholder={
                        slot === 1
                          ? "First required task"
                          : "Optional follow-up task"
                      }
                      required={slot === 1}
                      disabled={viewerMode}
                    />
                  </label>
                  <label className="field">
                    <span>Task {slot} agent</span>
                    <select
                      name="taskAgent"
                      defaultValue="shell"
                      disabled={viewerMode}
                    >
                      <option value="shell">Shell</option>
                      <option value="codex">Codex CLI</option>
                      <option value="fake-agent">Fake CLI Agent</option>
                    </select>
                  </label>
                </div>
                <label className="field">
                  <span>Task {slot} command</span>
                  <input
                    name="taskCommand"
                    placeholder="npm test or npm run patch"
                    disabled={viewerMode}
                  />
                </label>
                <label className="field">
                  <span>Task {slot} instructions</span>
                  <textarea
                    name="taskInstructions"
                    placeholder="Instructions for a CLI agent when no shell command is used"
                    rows={2}
                    disabled={viewerMode}
                  />
                </label>
                <div className="newRequirementTaskGrid">
                  <label className="field">
                    <span>Task {slot} timeout</span>
                    <input
                      name="taskTimeoutMs"
                      inputMode="numeric"
                      placeholder="milliseconds"
                      disabled={viewerMode}
                    />
                  </label>
                  <label className="field">
                    <span>Task {slot} depends on</span>
                    <input
                      name="taskDependsOn"
                      placeholder="task-1, task-2"
                      disabled={viewerMode}
                    />
                  </label>
                </div>
              </section>
            ))}
          </div>
        </fieldset>

        <fieldset className="newRequirementFieldset">
          <legend>Quality gates</legend>
          <div className="newRequirementGates">
            {gateSlots.map((slot) => (
              <section
                aria-label={`Gate ${slot} contract`}
                className="newRequirementGateCard"
                key={slot}
              >
                <div className="newRequirementTaskHeader">
                  <strong>Gate {slot}</strong>
                  <span>{slot === 1 ? "required" : "optional"}</span>
                </div>
                <label className="field">
                  <span>Gate {slot} command</span>
                  <input
                    name="gateCommand"
                    defaultValue={defaultGateCommands[slot - 1]}
                    placeholder="npm test or npm run smoke:ui"
                    required={slot === 1}
                    disabled={viewerMode}
                  />
                </label>
                <div className="newRequirementTaskGrid">
                  <label className="field">
                    <span>Gate {slot} requirement</span>
                    <select
                      name="gateRequired"
                      defaultValue={slot === 1 ? "required" : "optional"}
                      disabled={viewerMode}
                    >
                      <option value="required">Required</option>
                      <option value="optional">Optional</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Gate {slot} timeout</span>
                    <input
                      name="gateTimeoutMs"
                      inputMode="numeric"
                      placeholder="milliseconds"
                      disabled={viewerMode}
                    />
                  </label>
                </div>
              </section>
            ))}
          </div>
        </fieldset>

        {errors.length ? (
          <div className="errorText newRequirementErrors" role="alert">
            <strong>Complete the requirement draft</strong>
            <ul>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {submittedTitle ? (
          <div className="deliverySyncBanner" aria-live="polite">
            Draft payload submitted for {submittedTitle}
          </div>
        ) : null}

        <div className="newRequirementActions">
          <button className="secondaryButton" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primaryButton" type="submit" disabled={viewerMode}>
            <Send size={16} aria-hidden="true" />
            Create requirement draft
          </button>
        </div>
      </form>
    </section>
  );
}
