-- CreateTable: document_validation_reports
CREATE TABLE "document_validation_reports" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "valid" BOOLEAN NOT NULL,
    "violations" JSONB NOT NULL,
    "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_validation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_validation_reports_documentId_key" ON "document_validation_reports"("documentId");

-- AddForeignKey
ALTER TABLE "document_validation_reports" ADD CONSTRAINT "document_validation_reports_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "docflow_documents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
