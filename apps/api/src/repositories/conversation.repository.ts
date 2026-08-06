import type { PrismaClient, Prisma } from '@prisma/client';

export class ConversationRepository {
  constructor(private readonly db: PrismaClient) {}

  createConversation(data: Prisma.ConversationCreateInput) {
    return this.db.conversation.create({ data });
  }

  listConversations() { return this.db.conversation.findMany({ orderBy: { updatedAt: 'desc' } }); }

  findConversation(id: string) { return this.db.conversation.findUnique({ where: { id } }); }

  listTopics(conversationId: string) { return this.db.topic.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } }); }
  findTopic(id: string) { return this.db.topic.findUnique({ where: { id } }); }
  createTopic(data: Prisma.TopicUncheckedCreateInput) { return this.db.topic.create({ data }); }
  updateTopic(id: string, data: Prisma.TopicUpdateInput) { return this.db.topic.update({ where: { id }, data }); }
  updateNodeContext(id: string, contextEnabled: boolean) { return this.db.conversationNode.update({ where: { id }, data: { contextEnabled } }); }
  updateTopicContext(id: string, contextEnabled: boolean) { return this.db.topic.update({ where: { id }, data: { contextEnabled } }); }

  updateConversation(id: string, data: Prisma.ConversationUpdateInput) { return this.db.conversation.update({ where: { id }, data }); }

  deleteConversation(id: string) { return this.db.conversation.delete({ where: { id } }); }

  listActiveNodes(conversationId: string) {
    return this.db.conversationNode.findMany({ where: { conversationId, prunedAt: null }, orderBy: { createdAt: 'asc' } });
  }

  async createNode(data: Prisma.ConversationNodeUncheckedCreateInput) {
    if (data.parentId) {
      const parent = await this.db.conversationNode.findUnique({ where: { id: data.parentId }, select: { conversationId: true, topicId: true } });
      if (!parent) throw new Error('Parent node not found.');
      if (parent.conversationId !== data.conversationId) throw new Error('Parent node belongs to another conversation.');
      if (parent.topicId !== data.topicId) throw new Error('Parent node belongs to another topic.');
    }
    return this.db.conversationNode.create({ data });
  }
}
