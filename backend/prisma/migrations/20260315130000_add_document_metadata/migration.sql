-- AlterTable: add errorMessage to documents
ALTER TABLE "docflow_documents" ADD COLUMN "errorMessage" TEXT;

-- CreateTable: document_metadata
CREATE TABLE "document_metadata" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "title" TEXT,
    "author" TEXT,
    "docCreatedAt" TIMESTAMP(3),
    "lastModifiedAt" TIMESTAMP(3),
    "pageCount" INTEGER,
    "documentType" TEXT NOT NULL,
    "wordCount" INTEGER,
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_metadata_documentId_key" ON "document_metadata"("documentId");

-- AddForeignKey
ALTER TABLE "document_metadata" ADD CONSTRAINT "document_metadata_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "docflow_documents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
