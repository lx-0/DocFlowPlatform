-- Add soft-delete column to documents
ALTER TABLE "docflow_documents" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Create system_config key-value table
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- Seed default retention settings
INSERT INTO "system_config" ("key", "value", "updatedAt") VALUES
    ('documentRetentionDays', '365', CURRENT_TIMESTAMP),
    ('auditLogRetentionDays', '90', CURRENT_TIMESTAMP);
