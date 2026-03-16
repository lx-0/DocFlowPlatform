-- CreateTable: document_metrics (per-document lifecycle event timestamps)
CREATE TABLE "document_metrics" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "routedAt" TIMESTAMP(3),
    "firstReviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "processingTimeMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable: approver_metrics (daily rollup per approver)
CREATE TABLE "approver_metrics" (
    "id" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "assigned" INTEGER NOT NULL DEFAULT 0,
    "approved" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "avgResponseTimeMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approver_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable: queue_metrics (daily rollup per routing queue)
CREATE TABLE "queue_metrics" (
    "id" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "documentsIn" INTEGER NOT NULL DEFAULT 0,
    "documentsOut" INTEGER NOT NULL DEFAULT 0,
    "avgWaitTimeMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_metrics_documentId_key" ON "document_metrics"("documentId");
CREATE INDEX "document_metrics_submittedAt_idx" ON "document_metrics"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "approver_metrics_approverId_date_key" ON "approver_metrics"("approverId", "date");
CREATE INDEX "approver_metrics_date_idx" ON "approver_metrics"("date");

-- CreateIndex
CREATE UNIQUE INDEX "queue_metrics_queueId_date_key" ON "queue_metrics"("queueId", "date");
CREATE INDEX "queue_metrics_date_idx" ON "queue_metrics"("date");
