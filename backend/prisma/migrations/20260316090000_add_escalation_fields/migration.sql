-- AlterTable: add escalation config fields to routing_rules
ALTER TABLE "routing_rules" ADD COLUMN "escalation_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "routing_rules" ADD COLUMN "escalation_deadline_hours" INTEGER;
ALTER TABLE "routing_rules" ADD COLUMN "backup_approver_email" TEXT;

-- AlterTable: add step timing/escalation tracking to approval_steps
ALTER TABLE "approval_steps" ADD COLUMN "started_at" TIMESTAMP(3);
ALTER TABLE "approval_steps" ADD COLUMN "escalated_at" TIMESTAMP(3);
