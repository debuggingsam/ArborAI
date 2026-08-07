import { TopicContextCapsuleSchema } from '@arborai/shared';
import { ConversationRepository } from './repositories/conversation.repository.js';
import type { TreeMakerNodeRecord, TreeMakerStore, TreeMakerTopicRecord, TreeMakerWorkspaceRecord } from './tree-maker.service.js';

/** Prisma adapter for TreeMaker's application-facing store port. */
export class PrismaTreeMakerStore implements TreeMakerStore {
  constructor(private readonly repository: ConversationRepository) {}

  async findWorkspace(id: string): Promise<TreeMakerWorkspaceRecord | null> {
    const workspace = await this.repository.findConversation(id);
    return workspace ? { id: workspace.id, title: workspace.title, activeTopicId: workspace.activeTopicId } : null;
  }

  async listTopics(workspaceId: string): Promise<TreeMakerTopicRecord[]> {
    const topics = await this.repository.listTopics(workspaceId);
    return topics.map((topic) => ({
      id: topic.id, conversationId: topic.conversationId, parentTopicId: topic.parentTopicId,
      title: topic.title, description: topic.description, activeNodeId: topic.activeNodeId,
      contextEnabled: topic.contextEnabled, archivedAt: topic.archivedAt,
      contextCapsule: TopicContextCapsuleSchema.safeParse(topic.contextCapsule).success ? TopicContextCapsuleSchema.parse(topic.contextCapsule) : null,
      createdAt: topic.createdAt,
    }));
  }

  async listNodes(workspaceId: string): Promise<TreeMakerNodeRecord[]> {
    const nodes = await this.repository.listActiveNodes(workspaceId);
    return nodes.map((node) => ({
      id: node.id, conversationId: node.conversationId, topicId: node.topicId, parentId: node.parentId,
      role: node.role, content: node.content, contextEnabled: node.contextEnabled,
      prunedAt: node.prunedAt, createdAt: node.createdAt, updatedAt: node.updatedAt,
    }));
  }

  createRun(data: Parameters<TreeMakerStore['createRun']>[0]) {
    return this.repository.createTreeMakerRun(data);
  }
}
