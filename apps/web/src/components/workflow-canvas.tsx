"use client";

import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from "@xyflow/react";
import { useMemo } from "react";
import type {
  QualityGateRun,
  TaskRun,
  TaskStatus,
  WorkflowRun
} from "@mawo/shared";

type WorkflowNodeData = {
  title: string;
  agent: string;
  status: TaskStatus;
};

function WorkflowNode({ data }: NodeProps<Node<WorkflowNodeData>>) {
  return (
    <div className={`workflowNode ${data.status}`}>
      <Handle type="target" position={Position.Left} />
      <p className="nodeTitle">{data.title}</p>
      <p className="nodeMeta">
        {data.agent} / {data.status}
      </p>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = {
  workflow: WorkflowNode
};

function taskToNode(task: TaskRun, index: number): Node<WorkflowNodeData> {
  return {
    id: task.id,
    type: "workflow",
    position: { x: 40 + index * 260, y: 120 },
    data: {
      title: task.title,
      agent: task.agent ?? "agent",
      status: task.status
    }
  };
}

function gateToNode(
  gate: QualityGateRun,
  index: number,
  taskCount: number
): Node<WorkflowNodeData> {
  return {
    id: `gate-${gate.id}`,
    type: "workflow",
    position: { x: 40 + taskCount * 260, y: 40 + index * 130 },
    data: {
      title: gate.title,
      agent: "gate",
      status: gate.status
    }
  };
}

function buildGraph(workflow?: WorkflowRun): {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
} {
  if (!workflow) {
    return {
      nodes: [
        {
          id: "empty",
          type: "workflow",
          position: { x: 80, y: 120 },
          data: {
            title: "No workflow",
            agent: "local",
            status: "waiting"
          }
        }
      ],
      edges: []
    };
  }

  const taskNodes = workflow.tasks.map(taskToNode);
  const gateNodes = workflow.qualityGates.map((gate, index) =>
    gateToNode(gate, index, workflow.tasks.length)
  );
  const reportNode: Node<WorkflowNodeData> = {
    id: "report",
    type: "workflow",
    position: {
      x: 40 + (workflow.tasks.length + 1) * 260,
      y: 120
    },
    data: {
      title: "Run Report",
      agent: "aggregator",
      status:
        workflow.status === "needs_review"
          ? "reviewing"
          : workflow.status === "gate_failed" || workflow.status === "failed"
            ? "failed"
            : "waiting"
    }
  };

  const taskEdges = workflow.tasks.flatMap((task, index) => {
    if (task.dependsOn && task.dependsOn.length > 0) {
      return task.dependsOn.map((dependency) => ({
        id: `${dependency}-${task.id}`,
        source: dependency,
        target: task.id
      }));
    }

    if (index === 0) {
      return [];
    }

    const previous = workflow.tasks[index - 1];
    return previous
      ? [{ id: `${previous.id}-${task.id}`, source: previous.id, target: task.id }]
      : [];
  });
  const finalTask = workflow.tasks.at(-1);
  const gateEdges = finalTask
    ? workflow.qualityGates.map((gate) => ({
        id: `${finalTask.id}-gate-${gate.id}`,
        source: finalTask.id,
        target: `gate-${gate.id}`
      }))
    : [];
  const reportEdges = workflow.qualityGates.map((gate) => ({
    id: `gate-${gate.id}-report`,
    source: `gate-${gate.id}`,
    target: "report"
  }));

  return {
    nodes: [...taskNodes, ...gateNodes, reportNode],
    edges: [...taskEdges, ...gateEdges, ...reportEdges]
  };
}

export function WorkflowCanvas({ workflow }: { workflow?: WorkflowRun }) {
  const { nodes, edges } = useMemo(() => buildGraph(workflow), [workflow]);

  return (
    <div className="canvasShell">
      <ReactFlow
        fitView
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
