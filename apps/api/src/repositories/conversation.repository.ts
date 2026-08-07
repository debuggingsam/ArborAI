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
  findNode(id: string) { return this.db.conversationNode.findUnique({ where: { id } }); }
  createTopic(data: Prisma.TopicUncheckedCreateInput) { return this.db.topic.create({ data }); }
  updateTopic(id: string, data: Prisma.TopicUncheckedUpdateInput) { return this.db.topic.update({ where: { id }, data }); }
  async createTreeMakerRun(data: Prisma.TreeMakerRunUncheckedCreateInput) {
    const [activeTopic, activeNode] = await Promise.all([
      data.activeTopicId
        ? this.db.topic.findUnique({ where: { id: data.activeTopicId }, select: { conversationId: true } })
        : null,
      data.activeNodeId
        ? this.db.conversationNode.findUnique({ where: { id: data.activeNodeId }, select: { conversationId: true, topicId: true } })
        : null,
    ]);
    if (data.activeTopicId && (!activeTopic || activeTopic.conversationId !== data.conversationId)) {
      throw new Error('Active topic belongs to another conversation.');
    }
    if (data.activeNodeId && (!activeNode || activeNode.conversationId !== data.conversationId)) {
      throw new Error('Active node belongs to another conversation.');
    }
    if (data.activeTopicId && activeNode && activeNode.topicId !== data.activeTopicId) {
      throw new Error('Active node belongs to another topic.');
    }
    return this.db.treeMakerRun.create({ data });
  }
  async createGeneration(data: Prisma.GenerationUncheckedCreateInput) {
    const [topic, userNode, assistantNode, treeMakerRun] = await Promise.all([
      this.db.topic.findUnique({ where: { id: data.topicId }, select: { conversationId: true } }),
      this.db.conversationNode.findUnique({ where: { id: data.userNodeId }, select: { conversationId: true, topicId: true } }),
      this.db.conversationNode.findUnique({ where: { id: data.assistantNodeId }, select: { conversationId: true, topicId: true } }),
      data.treeMakerRunId
        ? this.db.treeMakerRun.findUnique({ where: { id: data.treeMakerRunId }, select: { conversationId: true } })
        : null,
    ]);
    if (!topic || topic.conversationId !== data.conversationId) throw new Error('Generation topic belongs to another conversation.');
    if (!userNode || userNode.conversationId !== data.conversationId || userNode.topicId !== data.topicId) {
      throw new Error('Generation user node must belong to the generation topic.');
    }
    if (!assistantNode || assistantNode.conversationId !== data.conversationId || assistantNode.topicId !== data.topicId) {
      throw new Error('Generation assistant node must belong to the generation topic.');
    }
    if (data.treeMakerRunId && (!treeMakerRun || treeMakerRun.conversationId !== data.conversationId)) {
      throw new Error('TreeMaker run belongs to another conversation.');
    }
    return this.db.generation.create({ data });
  }
  createGenerationContextSnapshot(data: Prisma.GenerationContextSnapshotUncheckedCreateInput) {
    return this.db.generationContextSnapshot.create({ data });
  }
  findGenerationContextSnapshot(generationId: string) {
    return this.db.generationContextSnapshot.findUnique({ where: { generationId } });
  }
  updateNodeContext(id: string, contextEnabled: boolean) { return this.db.conversationNode.update({ where: { id }, data: { contextEnabled } }); }
  updateNodePin(id: string, pinned: boolean) { return this.db.conversationNode.update({ where: { id }, data: { pinned } }); }
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
    const topic = await this.db.topic.findUnique({ where: { id: data.topicId }, select: { conversationId: true } });
    if (!topic) throw new Error('Topic not found.');
    if (topic.conversationId !== data.conversationId) throw new Error('Topic belongs to another conversation.');
    return this.db.conversationNode.create({ data });
  }
}
