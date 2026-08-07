import type { PrismaClient, Prisma } from '@prisma/client';
import { ConversationRepository } from './repositories/conversation.repository.js';

export class ConversationNotFoundError extends Error {}
export class TopicValidationError extends Error {}

export class ConversationService {
  private readonly repository: ConversationRepository;
  constructor(db: PrismaClient) { this.repository = new ConversationRepository(db); }

  async list() { return Promise.all((await this.repository.listConversations()).map((conversation) => this.toConversation(conversation)));
  }

  async create(data: { title: string; systemPrompt?: string }) {
    return this.toConversation(await this.repository.createConversation({ title: data.title.trim(), systemPrompt: data.systemPrompt ?? null }));
  }

  async get(id: string) {
    const conversation = await this.repository.findConversation(id);
    if (!conversation) throw new ConversationNotFoundError();
    const [nodes, topics] = await Promise.all([this.repository.listActiveNodes(id), this.repository.listTopics(id)]);
    const visibleTopicIds = this.visibleTopicIds(topics);
    const activeTopicId = conversation.activeTopicId && visibleTopicIds.has(conversation.activeTopicId) ? conversation.activeTopicId : null;
    return {
      conversation: this.toConversation(conversation),
      topics: topics.filter((topic) => visibleTopicIds.has(topic.id)).map((topic) => this.toTopic(topic)),
      nodes: nodes.filter((node) => visibleTopicIds.has(node.topicId)).map((node) => this.toNode(node)),
      activeTopicId,
    };
  }

  async createTopic(conversationId: string, data: { title: string; description?: string; parentTopicId?: string | null }) {
    const conversation = await this.repository.findConversation(conversationId); if (!conversation) throw new ConversationNotFoundError();
    if (data.parentTopicId) {
      const parent = await this.repository.findTopic(data.parentTopicId);
      if (!parent || parent.conversationId !== conversationId) throw new TopicValidationError('Parent topic belongs to another conversation.');
      if (parent.archivedAt) throw new TopicValidationError('Archived topics cannot be parents.');
    }
    return this.toTopic(await this.repository.createTopic({ conversationId, parentTopicId: data.parentTopicId ?? null, title: data.title.trim(), description: data.description ?? null, createdBy: 'user' }));
  }
  async moveTopic(id: string, parentTopicId: string | null) {
    const topic = await this.requireTopic(id);
    await this.assertValidTopicParent(topic, parentTopicId);
    return this.toTopic(await this.repository.updateTopic(id, { parentTopicId }));
  }
  async setTopicActiveNode(id: string, activeNodeId: string | null) {
    const topic = await this.requireTopic(id);
    if (activeNodeId) {
      const node = await this.repository.findNode(activeNodeId);
      if (!node || node.conversationId !== topic.conversationId || node.topicId !== topic.id || node.prunedAt) {
        throw new TopicValidationError('Active node must be a visible message in the topic.');
      }
    }
    return this.toTopic(await this.repository.updateTopic(id, { activeNodeId }));
  }
  async updateTopic(id: string, data: { title?: string; description?: string | null }) { try { return this.toTopic(await this.repository.updateTopic(id, { ...data, title: data.title?.trim() })); } catch (error) { if (this.isNotFound(error)) throw new TopicValidationError('Topic not found.'); throw error; } }
  async setTopicContext(id: string, enabled: boolean) { try { return this.toTopic(await this.repository.updateTopicContext(id, enabled)); } catch (error) { if (this.isNotFound(error)) throw new TopicValidationError('Topic not found.'); throw error; } }
  async setNodeContext(id: string, enabled: boolean) { try { return this.toNode(await this.repository.updateNodeContext(id, enabled)); } catch (error) { if (this.isNotFound(error)) throw new TopicValidationError('Node not found.'); throw error; } }
  async setNodePinned(id: string, pinned: boolean) { try { return this.toNode(await this.repository.updateNodePin(id, pinned)); } catch (error) { if (this.isNotFound(error)) throw new TopicValidationError('Node not found.'); throw error; } }
  async archiveTopic(id: string) { return this.setTopicArchived(id, new Date()); }
  async restoreTopic(id: string) { return this.setTopicArchived(id, null); }
  private async setTopicArchived(id: string, archivedAt: Date | null) { try { return this.toTopic(await this.repository.updateTopic(id, { archivedAt })); } catch (error) { if (this.isNotFound(error)) throw new TopicValidationError('Topic not found.'); throw error; } }

  async update(id: string, data: { title?: string; systemPrompt?: string; activeTopicId?: string | null }) {
    if (data.activeTopicId) {
      const topic = await this.repository.findTopic(data.activeTopicId);
      if (!topic || topic.conversationId !== id || topic.archivedAt) throw new TopicValidationError('Active topic must be a visible topic in the workspace.');
    }
    try { return this.toConversation(await this.repository.updateConversation(id, { ...data, title: data.title?.trim() })); }
    catch (error) { if (this.isNotFound(error)) throw new ConversationNotFoundError(); throw error; }
  }

  async delete(id: string) {
    try { await this.repository.deleteConversation(id); }
    catch (error) { if (this.isNotFound(error)) throw new ConversationNotFoundError(); throw error; }
  }

  private async requireTopic(id: string) {
    const topic = await this.repository.findTopic(id);
    if (!topic) throw new TopicValidationError('Topic not found.');
    return topic;
  }
  private async assertValidTopicParent(topic: { id: string; conversationId: string }, parentTopicId: string | null) {
    if (!parentTopicId) return;
    if (parentTopicId === topic.id) throw new TopicValidationError('A topic cannot be its own parent.');
    const visited = new Set<string>([topic.id]);
    let currentId: string | null = parentTopicId;
    while (currentId) {
      if (visited.has(currentId)) throw new TopicValidationError('Topic parent would create a cycle.');
      visited.add(currentId);
      const current = await this.repository.findTopic(currentId);
      if (!current || current.conversationId !== topic.conversationId) throw new TopicValidationError('Parent topic belongs to another conversation.');
      if (current.archivedAt) throw new TopicValidationError('Archived topics cannot be parents.');
      currentId = current.parentTopicId;
    }
  }

  private visibleTopicIds(topics: Array<{ id: string; parentTopicId: string | null; archivedAt: Date | null }>) {
    const byId = new Map(topics.map((topic) => [topic.id, topic]));
    const visible = new Set<string>();
    const visibility = new Map<string, boolean>();
    const visiting = new Set<string>();
    const isVisible = (topic: { id: string; parentTopicId: string | null; archivedAt: Date | null }): boolean => {
      const known = visibility.get(topic.id);
      if (known !== undefined) return known;
      if (topic.archivedAt || visiting.has(topic.id)) { visibility.set(topic.id, false); return false; }
      visiting.add(topic.id);
      const parent = topic.parentTopicId ? byId.get(topic.parentTopicId) : undefined;
      const result = !topic.parentTopicId || (parent !== undefined && isVisible(parent));
      visiting.delete(topic.id);
      visibility.set(topic.id, result);
      return result;
    };
    for (const topic of topics) if (isVisible(topic)) visible.add(topic.id);
    return visible;
  }

  private toConversation(value: { id: string; title: string; systemPrompt: string | null; activeTopicId: string | null; createdAt: Date; updatedAt: Date }) {
    return { id: value.id, title: value.title, systemPrompt: value.systemPrompt ?? '', activeTopicId: value.activeTopicId, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() };
  }
  private toNode(value: Prisma.ConversationNodeGetPayload<{}>) {
    return { ...value, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(), prunedAt: value.prunedAt?.toISOString() ?? null };
  }
  private toTopic(value: Prisma.TopicGetPayload<{}>) { return { ...value, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(), archivedAt: value.archivedAt?.toISOString() ?? null }; }
  private isNotFound(error: unknown) { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025'; }
}
