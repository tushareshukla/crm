-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- DropIndex
DROP INDEX "calendarEvent_iCalUid_originalStartTime_key";

-- DropIndex
DROP INDEX "company_domain_key";

-- DropIndex
DROP INDEX "contact_email_key";

-- DropIndex
DROP INDEX "emailMessage_rfcMessageId_key";

-- DropIndex
DROP INDEX "emailThread_rootMessageId_key";

-- DropIndex
DROP INDEX "fieldDefinition_entity_key_key";

-- DropIndex
DROP INDEX "mailboxSync_userId_source_key";

-- DropIndex
DROP INDEX "slackMemberMatch_crmUserId_key";

-- DropIndex
DROP INDEX "slackWorkspaceGrant_teamId_key";

-- DropIndex
DROP INDEX "trackedDomain_host_key";

-- AlterTable
ALTER TABLE "activity" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "agentAction" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "agentAuditEvent" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "agentBuilderArtifact" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "agentConversation" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "agentConversationAttachment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "agentConversationFeedback" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "agentConversationShare" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "agentConversationSubmission" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "agentDefinition" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "agentEvent" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "agentRun" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "agentRunEvent" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "agentTask" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "agentTrigger" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "agentVersion" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "appSetting" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "calendarAttendee" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "calendarEvent" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "companyEnrichment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "contact" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "contactBrief" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "contactFact" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "dealContact" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "emailMessage" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "emailThread" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "fieldDefinition" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "fieldOption" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "fieldValue" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "formSubmission" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "mailboxSync" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "member" ADD COLUMN     "lastActiveAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "limits" JSONB,
ADD COLUMN     "settings" JSONB,
ADD COLUMN     "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "slackChannel" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "slackInstallation" DROP CONSTRAINT "slackInstallation_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '',
ADD CONSTRAINT "slackInstallation_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "slackMemberMatch" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "slackWorkspaceGrant" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "suppressedContact" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "suppressedDomain" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "trackedDomain" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "trackedEvent" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "trackedPageDaily" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "trackedVisitor" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "trackingCounter" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "workspaceProfile" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "auditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "subject" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auditEvent_organizationId_createdAt_idx" ON "auditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "auditEvent_actorId_idx" ON "auditEvent"("actorId");

-- CreateIndex
CREATE INDEX "activity_organizationId_idx" ON "activity"("organizationId");

-- CreateIndex
CREATE INDEX "agentAction_organizationId_idx" ON "agentAction"("organizationId");

-- CreateIndex
CREATE INDEX "agentAuditEvent_organizationId_idx" ON "agentAuditEvent"("organizationId");

-- CreateIndex
CREATE INDEX "agentBuilderArtifact_organizationId_idx" ON "agentBuilderArtifact"("organizationId");

-- CreateIndex
CREATE INDEX "agentConversation_organizationId_idx" ON "agentConversation"("organizationId");

-- CreateIndex
CREATE INDEX "agentConversationAttachment_organizationId_idx" ON "agentConversationAttachment"("organizationId");

-- CreateIndex
CREATE INDEX "agentConversationFeedback_organizationId_idx" ON "agentConversationFeedback"("organizationId");

-- CreateIndex
CREATE INDEX "agentConversationShare_organizationId_idx" ON "agentConversationShare"("organizationId");

-- CreateIndex
CREATE INDEX "agentConversationSubmission_organizationId_idx" ON "agentConversationSubmission"("organizationId");

-- CreateIndex
CREATE INDEX "agentDefinition_organizationId_idx" ON "agentDefinition"("organizationId");

-- CreateIndex
CREATE INDEX "agentEvent_organizationId_idx" ON "agentEvent"("organizationId");

-- CreateIndex
CREATE INDEX "agentRun_organizationId_idx" ON "agentRun"("organizationId");

-- CreateIndex
CREATE INDEX "agentRunEvent_organizationId_idx" ON "agentRunEvent"("organizationId");

-- CreateIndex
CREATE INDEX "agentTask_organizationId_idx" ON "agentTask"("organizationId");

-- CreateIndex
CREATE INDEX "agentTrigger_organizationId_idx" ON "agentTrigger"("organizationId");

-- CreateIndex
CREATE INDEX "agentVersion_organizationId_idx" ON "agentVersion"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "appSetting_organizationId_key" ON "appSetting"("organizationId");

-- CreateIndex
CREATE INDEX "calendarAttendee_organizationId_idx" ON "calendarAttendee"("organizationId");

-- CreateIndex
CREATE INDEX "calendarEvent_organizationId_idx" ON "calendarEvent"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "calendarEvent_organizationId_iCalUid_originalStartTime_key" ON "calendarEvent"("organizationId", "iCalUid", "originalStartTime");

-- CreateIndex
CREATE INDEX "company_organizationId_idx" ON "company"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "company_organizationId_domain_key" ON "company"("organizationId", "domain");

-- CreateIndex
CREATE INDEX "companyEnrichment_organizationId_idx" ON "companyEnrichment"("organizationId");

-- CreateIndex
CREATE INDEX "contact_organizationId_idx" ON "contact"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_organizationId_email_key" ON "contact"("organizationId", "email");

-- CreateIndex
CREATE INDEX "contactBrief_organizationId_idx" ON "contactBrief"("organizationId");

-- CreateIndex
CREATE INDEX "contactFact_organizationId_idx" ON "contactFact"("organizationId");

-- CreateIndex
CREATE INDEX "deal_organizationId_idx" ON "deal"("organizationId");

-- CreateIndex
CREATE INDEX "dealContact_organizationId_idx" ON "dealContact"("organizationId");

-- CreateIndex
CREATE INDEX "emailMessage_organizationId_idx" ON "emailMessage"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "emailMessage_organizationId_rfcMessageId_key" ON "emailMessage"("organizationId", "rfcMessageId");

-- CreateIndex
CREATE INDEX "emailThread_organizationId_idx" ON "emailThread"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "emailThread_organizationId_rootMessageId_key" ON "emailThread"("organizationId", "rootMessageId");

-- CreateIndex
CREATE INDEX "fieldDefinition_organizationId_idx" ON "fieldDefinition"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "fieldDefinition_organizationId_entity_key_key" ON "fieldDefinition"("organizationId", "entity", "key");

-- CreateIndex
CREATE INDEX "fieldOption_organizationId_idx" ON "fieldOption"("organizationId");

-- CreateIndex
CREATE INDEX "fieldValue_organizationId_idx" ON "fieldValue"("organizationId");

-- CreateIndex
CREATE INDEX "formSubmission_organizationId_idx" ON "formSubmission"("organizationId");

-- CreateIndex
CREATE INDEX "mailboxSync_organizationId_idx" ON "mailboxSync"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "mailboxSync_organizationId_userId_source_key" ON "mailboxSync"("organizationId", "userId", "source");

-- CreateIndex
CREATE INDEX "slackChannel_organizationId_idx" ON "slackChannel"("organizationId");

-- CreateIndex
CREATE INDEX "slackInstallation_organizationId_idx" ON "slackInstallation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "slackInstallation_organizationId_installerId_key" ON "slackInstallation"("organizationId", "installerId");

-- CreateIndex
CREATE INDEX "slackMemberMatch_organizationId_idx" ON "slackMemberMatch"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "slackMemberMatch_organizationId_crmUserId_key" ON "slackMemberMatch"("organizationId", "crmUserId");

-- CreateIndex
CREATE INDEX "slackWorkspaceGrant_organizationId_idx" ON "slackWorkspaceGrant"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "slackWorkspaceGrant_organizationId_teamId_key" ON "slackWorkspaceGrant"("organizationId", "teamId");

-- CreateIndex
CREATE INDEX "suppressedContact_organizationId_idx" ON "suppressedContact"("organizationId");

-- CreateIndex
CREATE INDEX "suppressedDomain_organizationId_idx" ON "suppressedDomain"("organizationId");

-- CreateIndex
CREATE INDEX "trackedDomain_organizationId_idx" ON "trackedDomain"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "trackedDomain_organizationId_host_key" ON "trackedDomain"("organizationId", "host");

-- CreateIndex
CREATE INDEX "trackedEvent_organizationId_idx" ON "trackedEvent"("organizationId");

-- CreateIndex
CREATE INDEX "trackedPageDaily_organizationId_idx" ON "trackedPageDaily"("organizationId");

-- CreateIndex
CREATE INDEX "trackedVisitor_organizationId_idx" ON "trackedVisitor"("organizationId");

-- CreateIndex
CREATE INDEX "trackingCounter_organizationId_idx" ON "trackingCounter"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "workspaceProfile_organizationId_key" ON "workspaceProfile"("organizationId");

-- AddForeignKey
ALTER TABLE "slackMemberMatch" ADD CONSTRAINT "slackMemberMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slackChannel" ADD CONSTRAINT "slackChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slackInstallation" ADD CONSTRAINT "slackInstallation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slackWorkspaceGrant" ADD CONSTRAINT "slackWorkspaceGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companyEnrichment" ADD CONSTRAINT "companyEnrichment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contactFact" ADD CONSTRAINT "contactFact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contactBrief" ADD CONSTRAINT "contactBrief_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentTask" ADD CONSTRAINT "agentTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentEvent" ADD CONSTRAINT "agentEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentConversation" ADD CONSTRAINT "agentConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentConversationFeedback" ADD CONSTRAINT "agentConversationFeedback_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentConversationShare" ADD CONSTRAINT "agentConversationShare_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentConversationSubmission" ADD CONSTRAINT "agentConversationSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentConversationAttachment" ADD CONSTRAINT "agentConversationAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentDefinition" ADD CONSTRAINT "agentDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentVersion" ADD CONSTRAINT "agentVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentBuilderArtifact" ADD CONSTRAINT "agentBuilderArtifact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentTrigger" ADD CONSTRAINT "agentTrigger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentRun" ADD CONSTRAINT "agentRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentRunEvent" ADD CONSTRAINT "agentRunEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentAction" ADD CONSTRAINT "agentAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentAuditEvent" ADD CONSTRAINT "agentAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealContact" ADD CONSTRAINT "dealContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fieldDefinition" ADD CONSTRAINT "fieldDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fieldOption" ADD CONSTRAINT "fieldOption_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fieldValue" ADD CONSTRAINT "fieldValue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailboxSync" ADD CONSTRAINT "mailboxSync_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emailThread" ADD CONSTRAINT "emailThread_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emailMessage" ADD CONSTRAINT "emailMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendarEvent" ADD CONSTRAINT "calendarEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendarAttendee" ADD CONSTRAINT "calendarAttendee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppressedDomain" ADD CONSTRAINT "suppressedDomain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppressedContact" ADD CONSTRAINT "suppressedContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appSetting" ADD CONSTRAINT "appSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trackedDomain" ADD CONSTRAINT "trackedDomain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trackedVisitor" ADD CONSTRAINT "trackedVisitor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trackedEvent" ADD CONSTRAINT "trackedEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trackingCounter" ADD CONSTRAINT "trackingCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trackedPageDaily" ADD CONSTRAINT "trackedPageDaily_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formSubmission" ADD CONSTRAINT "formSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaceProfile" ADD CONSTRAINT "workspaceProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditEvent" ADD CONSTRAINT "auditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditEvent" ADD CONSTRAINT "auditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
