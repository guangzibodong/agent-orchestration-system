-- CreateTable
CREATE TABLE "RepositoryRecord" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "defaultBranch" TEXT,
    "qualityGates" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "executionMode" TEXT NOT NULL DEFAULT 'direct',
    "repositoryId" TEXT,
    "repositoryPath" TEXT,
    "worktreeRoot" TEXT,
    "reviewDecision" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTaskRun" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "agent" TEXT,
    "command" TEXT,
    "instructions" TEXT,
    "cwd" TEXT,
    "timeoutMs" INTEGER,
    "position" INTEGER NOT NULL,
    "dependsOn" JSONB,
    "result" JSONB,
    "workspace" JSONB,
    "diff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTaskRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityGateRun" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "cwd" TEXT,
    "timeoutMs" INTEGER,
    "position" INTEGER NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityGateRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowJob" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor" TEXT,
    "workflowRunId" TEXT,
    "jobId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtifactRecord" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "taskRunId" TEXT,
    "qualityGateRunId" TEXT,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MergeCandidateRecord" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceBranches" JSONB NOT NULL,
    "patch" TEXT NOT NULL,
    "patchArtifactPath" TEXT,
    "manifestArtifactPath" TEXT,
    "applyCommand" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MergeCandidateRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryRecord_path_key" ON "RepositoryRecord"("path");

-- CreateIndex
CREATE INDEX "RepositoryRecord_updatedAt_idx" ON "RepositoryRecord"("updatedAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_repositoryId_updatedAt_idx" ON "WorkflowRun"("repositoryId", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_repositoryPath_idx" ON "WorkflowRun"("repositoryPath");

-- CreateIndex
CREATE INDEX "WorkflowRun_status_updatedAt_idx" ON "WorkflowRun"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTaskRun_workflowRunId_taskId_key" ON "WorkflowTaskRun"("workflowRunId", "taskId");

-- CreateIndex
CREATE INDEX "WorkflowTaskRun_workflowRunId_status_idx" ON "WorkflowTaskRun"("workflowRunId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QualityGateRun_workflowRunId_gateId_key" ON "QualityGateRun"("workflowRunId", "gateId");

-- CreateIndex
CREATE INDEX "QualityGateRun_workflowRunId_status_idx" ON "QualityGateRun"("workflowRunId", "status");

-- CreateIndex
CREATE INDEX "WorkflowJob_status_updatedAt_idx" ON "WorkflowJob"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkflowJob_workflowRunId_status_idx" ON "WorkflowJob"("workflowRunId", "status");

-- CreateIndex
CREATE INDEX "AuditEvent_jobId_createdAt_idx" ON "AuditEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_type_createdAt_idx" ON "AuditEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_workflowRunId_createdAt_idx" ON "AuditEvent"("workflowRunId", "createdAt");

-- CreateIndex
CREATE INDEX "ArtifactRecord_path_idx" ON "ArtifactRecord"("path");

-- CreateIndex
CREATE INDEX "ArtifactRecord_workflowRunId_kind_idx" ON "ArtifactRecord"("workflowRunId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "MergeCandidateRecord_workflowRunId_key" ON "MergeCandidateRecord"("workflowRunId");

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "RepositoryRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTaskRun" ADD CONSTRAINT "WorkflowTaskRun_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityGateRun" ADD CONSTRAINT "QualityGateRun_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowJob" ADD CONSTRAINT "WorkflowJob_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "WorkflowJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactRecord" ADD CONSTRAINT "ArtifactRecord_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactRecord" ADD CONSTRAINT "ArtifactRecord_taskRunId_fkey" FOREIGN KEY ("taskRunId") REFERENCES "WorkflowTaskRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactRecord" ADD CONSTRAINT "ArtifactRecord_qualityGateRunId_fkey" FOREIGN KEY ("qualityGateRunId") REFERENCES "QualityGateRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MergeCandidateRecord" ADD CONSTRAINT "MergeCandidateRecord_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
