import { Prisma, type PrismaClient } from '@prisma/client';
import { TopicContextCapsuleSchema, type ContextPreviewResponse } from '@arborai/shared';
import type { ConversationRepository } from './repositories/conversation.repository.js';
import type { GenerationPlacement, GenerationStore } from './generation.service.js';

/** Prisma adapter keeps all initial graph/snapshot writes in one short transaction. */
export class PrismaGenerationStore implements GenerationStore {
  constructor(private readonly repository: ConversationRepository, private readonly db: PrismaClient) {}
  async findWorkspace(id: string) { const item = await this.repository.findConversation(id); return item ? { id: item.id, title: item.title, systemPrompt: item.systemPrompt, activeTopicId: item.activeTopicId } : null; }
  async listTopics(workspaceId: string) { return (await this.repository.listTopics(workspaceId)).map((topic) => ({ ...topic, contextCapsule: TopicContextCapsuleSchema.safeParse(topic.contextCapsule).success ? TopicContextCapsuleSchema.parse(topic.contextCapsule) : null })); }
  listNodes(workspaceId: string) { return this.repository.listNodes(workspaceId); }
  async initialize(workspaceId: string, request: Parameters<GenerationStore['initialize']>[1], placement: GenerationPlacement, context: ContextPreviewResponse, treeMakerRunId: string | null) {
    return this.db.$transaction(async (tx) => {
      if (placement.createTopic) await tx.topic.create({ data: { id: placement.topicId, conversationId: workspaceId, parentTopicId: placement.createTopic.parentTopicId, title: placement.createTopic.title, description: placement.createTopic.description, createdBy: placement.createTopic.createdBy } });
      const userNodeId = request.mode === 'regenerate' ? request.userNodeId : crypto.randomUUID();
      if (request.mode !== 'regenerate') await tx.conversationNode.create({ data: { id: userNodeId, conversationId: workspaceId, topicId: placement.topicId, parentId: placement.anchorNodeId, role: 'user', content: placement.prompt, status: 'completed' } });
      const assistantNodeId = crypto.randomUUID();
      await tx.conversationNode.create({ data: { id: assistantNodeId, conversationId: workspaceId, topicId: placement.topicId, parentId: userNodeId, role: 'assistant', content: '', status: 'pending' } });
      const generation = await tx.generation.create({ data: { conversationId: workspaceId, topicId: placement.topicId, treeMakerRunId, userNodeId, assistantNodeId, mode: request.mode, provider: placement.provider ?? 'unknown', model: placement.model ?? 'unknown', status: 'pending' } });
      await tx.generationContextSnapshot.create({ data: { generationId: generation.id, orderedModelMessages: context.messages, includedTopicIds: context.includedTopicIds, includedNodeIds: context.includedNodeIds, excludedTopicIds: context.excludedTopicIds, excludedNodeIds: context.excludedNodeIds, exclusions: context.exclusions, warnings: context.warnings, estimatedInputTokens: context.estimatedInputTokens, maxInputTokens: context.maxInputTokens } });
      await tx.conversation.update({ where: { id: workspaceId }, data: { activeTopicId: placement.topicId } });
      await tx.topic.update({ where: { id: placement.topicId }, data: { activeNodeId: assistantNodeId } });
      return { generationId: generation.id, topicId: placement.topicId, userNodeId, assistantNodeId, context, createdTopicId: placement.createTopic ? placement.topicId : null };
    });
  }
  async markStreaming(generationId: string, assistantNodeId: string) { await this.db.$transaction([this.db.generation.update({ where: { id: generationId }, data: { status: 'streaming' } }), this.db.conversationNode.update({ where: { id: assistantNodeId }, data: { status: 'streaming' } })]); }
  async appendDelta(assistantNodeId: string, delta: string) {
    // An atomic SQL concatenation prevents concurrent delta writers from losing
    // already-persisted partial text.
    await this.db.$executeRaw(Prisma.sql`UPDATE "ConversationNode" SET "content" = "content" || ${delta}, "updatedAt" = NOW() WHERE "id" = ${assistantNodeId}::uuid`);
  }
  async complete(generationId: string, assistantNodeId: string, inputTokenCount: number | null, outputTokenCount: number | null) { await this.db.$transaction([this.db.generation.update({ where: { id: generationId }, data: { status: 'completed', inputTokenCount, outputTokenCount, completedAt: new Date() } }), this.db.conversationNode.update({ where: { id: assistantNodeId }, data: { status: 'completed', tokenCount: outputTokenCount } })]); }
  async fail(generationId: string, assistantNodeId: string, errorMessage: string) { await this.db.$transaction([this.db.generation.update({ where: { id: generationId }, data: { status: 'error', errorMessage, completedAt: new Date() } }), this.db.conversationNode.update({ where: { id: assistantNodeId }, data: { status: 'error', errorMessage } })]); }
}
