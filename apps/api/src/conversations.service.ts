import type { PrismaClient, Prisma } from '@prisma/client';
import { ConversationRepository } from './repositories/conversation.repository.js';

export class ConversationNotFoundError extends Error {}
export class TopicValidationError extends Error {}

export type ConversationGraphEvent =
  | { eventType: 'topic.created' | 'topic.updated' | 'topic.context_updated' | 'topic.archived' | 'topic.restored'; workspaceId: string; topic: ReturnType<ConversationService['toTopic']> }
  | { eventType: 'topic.moved'; workspaceId: string; topicId: string; parentTopicId: string | null }
  | { eventType: 'node.context_updated' | 'node.updated'; workspaceId: string; node: ReturnType<ConversationService['toNode']> }
  | { eventType: 'node.pruned'; workspaceId: string; nodeId: string; prunedNodeIds: string[]; activeNodeId: string | null };

export class ConversationService {
  private readonly repository: ConversationRepository;
  constructor(db: PrismaClient, private readonly events?: { publish(event: ConversationGraphEvent): void }) { this.repository = new ConversationRepository(db); }

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
    const created = this.toTopic(await this.repository.createTopic({ conversationId, parentTopicId: data.parentTopicId ?? null, title: data.title.trim(), description: data.description ?? null, createdBy: 'user' }));
    this.events?.publish({ eventType: 'topic.created', workspaceId: conversationId, topic: created });
    return created;
  }
  async moveTopic(id: string, parentTopicId: string | null) {
    const topic = await this.requireTopic(id);
    await this.assertValidTopicParent(topic, parentTopicId);
    const moved = this.toTopic(await this.repository.updateTopic(id, { parentTopicId }));
    this.events?.publish({ eventType: 'topic.moved', workspaceId: topic.conversationId, topicId: id, parentTopicId });
    return moved;
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
  async updateTopic(id: string, data: { title?: string; description?: string | null }) { try { const updated = this.toTopic(await this.repository.updateTopic(id, { ...data, title: data.title?.trim() })); this.events?.publish({ eventType: 'topic.updated', workspaceId: updated.conversationId, topic: updated }); return updated; } catch (error) { if (this.isNotFound(error)) throw new TopicValidationError('Topic not found.'); throw error; } }
  async setTopicContext(id: string, enabled: boolean) { try { const updated = this.toTopic(await this.repository.updateTopicContext(id, enabled)); this.events?.publish({ eventType: 'topic.context_updated', workspaceId: updated.conversationId, topic: updated }); return updated; } catch (error) { if (this.isNotFound(error)) throw new TopicValidationError('Topic not found.'); throw error; } }
  async setNodeContext(id: string, enabled: boolean) { try { const updated = this.toNode(await this.repository.updateNodeContext(id, enabled)); this.events?.publish({ eventType: 'node.context_updated', workspaceId: updated.conversationId, node: updated }); return updated; } catch (error) { if (this.isNotFound(error)) throw new TopicValidationError('Node not found.'); throw error; } }
  async setNodePinned(id: string, pinned: boolean) { try { const updated = this.toNode(await this.repository.updateNodePin(id, pinned)); this.events?.publish({ eventType: 'node.updated', workspaceId: updated.conversationId, node: updated }); return updated; } catch (error) { if (this.isNotFound(error)) throw new TopicValidationError('Node not found.'); throw error; } }
  async archiveTopic(id: string) { return this.setTopicArchived(id, new Date()); }
  async restoreTopic(id: string) { return this.setTopicArchived(id, null); }
  private async setTopicArchived(id: string, archivedAt: Date | null) { try { const updated = this.toTopic(await this.repository.updateTopic(id, { archivedAt })); this.events?.publish({ eventType: archivedAt ? 'topic.archived' : 'topic.restored', workspaceId: updated.conversationId, topic: updated }); return updated; } catch (error) { if (this.isNotFound(error)) throw new TopicValidationError('Topic not found.'); throw error; } }

  async archivedTopics(conversationId: string) {
    const conversation = await this.repository.findConversation(conversationId);
    if (!conversation) throw new ConversationNotFoundError();
    const topics = await this.repository.listTopics(conversationId);
    const byId = new Map(topics.map((topic) => [topic.id, topic]));
    const archived = (topic: (typeof topics)[number]) => {
      const seen = new Set<string>(); let current: (typeof topics)[number] | undefined = topic;
      while (current && !seen.has(current.id)) { if (current.archivedAt) return true; seen.add(current.id); current = current.parentTopicId ? byId.get(current.parentTopicId) : undefined; }
      return false;
    };
    return topics.filter(archived).map((topic) => this.toTopic(topic));
  }

  async pruneNode(id: string) {
    const root = await this.repository.findNode(id);
    if (!root) throw new TopicValidationError('Node not found.');
    if (root.prunedAt) throw new TopicValidationError('Node is already pruned.');
    const nodes = await this.repository.listNodes(root.conversationId);
    const byParent = new Map<string | null, typeof nodes>();
    for (const node of nodes) { const children = byParent.get(node.parentId) ?? []; children.push(node); byParent.set(node.parentId, children); }
    const descendants: typeof nodes = []; const queue = [root.id]; const seen = new Set<string>();
    while (queue.length) { const currentId = queue.shift()!; if (seen.has(currentId)) continue; seen.add(currentId); const current = nodes.find((node) => node.id === currentId); if (!current || current.prunedAt || current.topicId !== root.topicId) continue; descendants.push(current); for (const child of byParent.get(currentId) ?? []) if (child.topicId === root.topicId) queue.push(child.id); }
    if (descendants.some((node) => node.status === 'pending' || node.status === 'streaming')) throw new TopicValidationError('Streaming or pending message branches cannot be pruned.');
    await this.repository.updateNodesPruned(descendants.map((node) => node.id), new Date());
    const topic = await this.requireTopic(root.topicId);
    let activeNodeId = topic.activeNodeId;
    if (activeNodeId && descendants.some((node) => node.id === activeNodeId)) {
      const pruned = new Set(descendants.map((node) => node.id)); let fallback = nodes.find((node) => node.id === activeNodeId);
      while (fallback && pruned.has(fallback.id)) fallback = fallback.parentId ? nodes.find((node) => node.id === fallback!.parentId) : undefined;
      activeNodeId = fallback?.id ?? null;
      await this.repository.updateTopic(topic.id, { activeNodeId });
    }
    this.events?.publish({ eventType: 'node.pruned', workspaceId: root.conversationId, nodeId: root.id, prunedNodeIds: descendants.map((node) => node.id), activeNodeId });
    return { conversationId: root.conversationId, prunedNodeId: root.id, prunedNodeCount: descendants.length, activeNodeId };
  }

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
