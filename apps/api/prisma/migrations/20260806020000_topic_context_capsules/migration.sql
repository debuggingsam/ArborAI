CREATE TYPE "TopicCreatedBy" AS ENUM ('user', 'tree_maker', 'migration');

ALTER TABLE "Topic"
  ADD COLUMN "contextCapsule" JSONB,
  ADD COLUMN "capsuleVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "capsuleUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "createdBy" "TopicCreatedBy" NOT NULL DEFAULT 'migration';

ALTER TABLE "ConversationNode"
  ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "ConversationNode_conversationId_prunedAt_idx"
  ON "ConversationNode"("conversationId", "prunedAt");

UPDATE "Topic" AS topic
SET "activeNodeId" = NULL
WHERE "activeNodeId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "ConversationNode" AS node
    WHERE node."id" = topic."activeNodeId"
      AND node."topicId" = topic."id"
      AND node."prunedAt" IS NULL
  );

ALTER TABLE "Topic"
  ADD CONSTRAINT "Topic_activeNodeId_fkey"
  FOREIGN KEY ("activeNodeId") REFERENCES "ConversationNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
