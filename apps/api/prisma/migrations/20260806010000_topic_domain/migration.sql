CREATE TABLE "Topic" (
  "id" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "parentTopicId" UUID,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "activeNodeId" UUID,
  "contextEnabled" BOOLEAN NOT NULL DEFAULT true,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Conversation" ADD COLUMN "activeTopicId" UUID;
ALTER TABLE "ConversationNode" ADD COLUMN "topicId" UUID;
ALTER TABLE "ConversationNode" ADD COLUMN "contextEnabled" BOOLEAN NOT NULL DEFAULT true;
INSERT INTO "Topic" ("id", "conversationId", "title", "description", "activeNodeId", "updatedAt")
SELECT gen_random_uuid(), c."id", 'Imported conversation', 'Imported from the conversation message tree.', c."activeNodeId", CURRENT_TIMESTAMP FROM "Conversation" c;
UPDATE "ConversationNode" n SET "topicId" = t."id" FROM "Topic" t WHERE t."conversationId" = n."conversationId";
UPDATE "Conversation" c SET "activeTopicId" = t."id" FROM "Topic" t WHERE t."conversationId" = c."id";
ALTER TABLE "ConversationNode" ALTER COLUMN "topicId" SET NOT NULL;
CREATE INDEX "Topic_conversationId_idx" ON "Topic"("conversationId");
CREATE INDEX "Topic_parentTopicId_idx" ON "Topic"("parentTopicId");
CREATE INDEX "ConversationNode_topicId_idx" ON "ConversationNode"("topicId");
CREATE INDEX "Topic_conversationId_archivedAt_idx" ON "Topic"("conversationId", "archivedAt");
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_parentTopicId_fkey" FOREIGN KEY ("parentTopicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationNode" ADD CONSTRAINT "ConversationNode_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
