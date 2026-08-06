CREATE TYPE "TreeMakerRunStatus" AS ENUM ('completed', 'failed', 'fallback');
CREATE TYPE "GenerationMode" AS ENUM ('auto_route', 'manual_continue', 'manual_subtopic', 'manual_root_topic', 'regenerate');
CREATE TYPE "GenerationStatus" AS ENUM ('pending', 'streaming', 'completed', 'error');

CREATE TABLE "TreeMakerRun" (
  "id" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "newPrompt" TEXT NOT NULL,
  "activeTopicId" UUID,
  "activeNodeId" UUID,
  "inputTreeIndex" JSONB NOT NULL,
  "outputDecision" JSONB,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "status" "TreeMakerRunStatus" NOT NULL,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TreeMakerRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Generation" (
  "id" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "topicId" UUID NOT NULL,
  "treeMakerRunId" UUID,
  "userNodeId" UUID NOT NULL,
  "assistantNodeId" UUID NOT NULL,
  "mode" "GenerationMode" NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "status" "GenerationStatus" NOT NULL,
  "inputTokenCount" INTEGER,
  "outputTokenCount" INTEGER,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GenerationContextSnapshot" (
  "id" UUID NOT NULL,
  "generationId" UUID NOT NULL,
  "orderedModelMessages" JSONB NOT NULL,
  "includedTopicIds" JSONB NOT NULL,
  "includedNodeIds" JSONB NOT NULL,
  "excludedTopicIds" JSONB NOT NULL,
  "excludedNodeIds" JSONB NOT NULL,
  "exclusions" JSONB NOT NULL,
  "warnings" JSONB NOT NULL,
  "estimatedInputTokens" INTEGER NOT NULL,
  "maxInputTokens" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GenerationContextSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GenerationContextSnapshot_generationId_key" ON "GenerationContextSnapshot"("generationId");
CREATE INDEX "TreeMakerRun_conversationId_createdAt_idx" ON "TreeMakerRun"("conversationId", "createdAt");
CREATE INDEX "TreeMakerRun_conversationId_status_idx" ON "TreeMakerRun"("conversationId", "status");
CREATE INDEX "Generation_conversationId_startedAt_idx" ON "Generation"("conversationId", "startedAt");
CREATE INDEX "Generation_topicId_startedAt_idx" ON "Generation"("topicId", "startedAt");
CREATE INDEX "Generation_treeMakerRunId_idx" ON "Generation"("treeMakerRunId");
CREATE INDEX "Generation_userNodeId_idx" ON "Generation"("userNodeId");
CREATE INDEX "Generation_assistantNodeId_idx" ON "Generation"("assistantNodeId");
CREATE INDEX "Generation_conversationId_status_idx" ON "Generation"("conversationId", "status");

ALTER TABLE "TreeMakerRun" ADD CONSTRAINT "TreeMakerRun_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_topicId_fkey"
  FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_treeMakerRunId_fkey"
  FOREIGN KEY ("treeMakerRunId") REFERENCES "TreeMakerRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_userNodeId_fkey"
  FOREIGN KEY ("userNodeId") REFERENCES "ConversationNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_assistantNodeId_fkey"
  FOREIGN KEY ("assistantNodeId") REFERENCES "ConversationNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GenerationContextSnapshot" ADD CONSTRAINT "GenerationContextSnapshot_generationId_fkey"
  FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
