import { TopicContextCapsuleSchema, type NodeRole } from '@arborai/shared';
import { ConversationRepository } from './repositories/conversation.repository.js';
import type { ContextPreviewStore } from './context-preview.service.js';

/** Prisma adapter that deliberately includes archived and pruned records for exclusion reporting. */
export class PrismaContextPreviewStore implements ContextPreviewStore {
  constructor(private readonly repository: ConversationRepository) {}

  async findWorkspace(id: string) {
    const workspace = await this.repository.findConversation(id);
    return workspace ? { id: workspace.id, systemPrompt: workspace.systemPrompt } : null;
  }

  async listTopics(workspaceId: string) {
    const topics = await this.repository.listTopics(workspaceId);
    return topics.map((topic) => ({
      id: topic.id,
      conversationId: topic.conversationId,
      parentTopicId: topic.parentTopicId,
      title: topic.title,
      contextEnabled: topic.contextEnabled,
      archivedAt: topic.archivedAt,
      contextCapsule: TopicContextCapsuleSchema.safeParse(topic.contextCapsule).success
        ? TopicContextCapsuleSchema.parse(topic.contextCapsule)
        : null,
    }));
  }

  async listNodes(workspaceId: string) {
    const nodes = await this.repository.listNodes(workspaceId);
    return nodes.map((node) => ({
      id: node.id,
      conversationId: node.conversationId,
      topicId: node.topicId,
      parentId: node.parentId,
      role: node.role as NodeRole,
      content: node.content,
      contextEnabled: node.contextEnabled,
      pinned: node.pinned,
      prunedAt: node.prunedAt,
      createdAt: node.createdAt,
    }));
  }
}
