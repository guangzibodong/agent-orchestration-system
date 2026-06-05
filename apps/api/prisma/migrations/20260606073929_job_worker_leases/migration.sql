-- AlterTable
ALTER TABLE "WorkflowJob" ADD COLUMN "lockedBy" TEXT;
ALTER TABLE "WorkflowJob" ADD COLUMN "lockedAt" TIMESTAMP(3);
ALTER TABLE "WorkflowJob" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "WorkflowJob" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "WorkflowJob_status_leaseExpiresAt_idx" ON "WorkflowJob"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "WorkflowJob_lockedBy_leaseExpiresAt_idx" ON "WorkflowJob"("lockedBy", "leaseExpiresAt");
