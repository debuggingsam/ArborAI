CREATE TYPE "NodeRole" AS ENUM ('system', 'user', 'assistant');
CREATE TYPE "NodeStatus" AS ENUM ('pending', 'streaming', 'completed', 'error');

CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "activeNodeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationNode" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "parentId" UUID,
    "role" "NodeRole" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "NodeStatus" NOT NULL,
    "tokenCount" INTEGER,
    "errorMessage" TEXT,
    "prunedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConversationNode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");
CREATE INDEX "ConversationNode_conversationId_idx" ON "ConversationNode"("conversationId");
CREATE INDEX "ConversationNode_parentId_idx" ON "ConversationNode"("parentId");
CREATE INDEX "ConversationNode_conversationId_createdAt_idx" ON "ConversationNode"("conversationId", "createdAt");
ALTER TABLE "ConversationNode" ADD CONSTRAINT "ConversationNode_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationNode" ADD CONSTRAINT "ConversationNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ConversationNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
