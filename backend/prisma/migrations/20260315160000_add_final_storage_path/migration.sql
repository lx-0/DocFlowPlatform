-- Add finalStoragePath to store the cover-sheet-prefixed document
ALTER TABLE "docflow_documents" ADD COLUMN "finalStoragePath" TEXT;
