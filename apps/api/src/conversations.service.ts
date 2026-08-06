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
    return { conversation: this.toConversation(conversation), topics: topics.map(topic => this.toTopic(topic)), nodes: nodes.map((node) => this.toNode(node)), activeTopicId: conversation.activeTopicId };
  }

  async createTopic(conversationId: string, data: { title: string; description?: string; parentTopicId?: string | null }) {
    const conversation = await this.repository.findConversation(conversationId); if (!conversation) throw new ConversationNotFoundError();
    if (data.parentTopicId) { const parent = await this.repository.findTopic(data.parentTopicId); if (!parent || parent.conversationId !== conversationId) throw new TopicValidationError('Parent topic belongs to another conversation.'); }
    return this.toTopic(await this.repository.createTopic({ conversationId, parentTopicId: data.parentTopicId ?? null, title: data.title.trim(), description: data.description ?? null }));
  }
  async updateTopic(id: string, data: { title?: string; description?: string | null }) { try { return this.toTopic(await this.repository.updateTopic(id, { ...data, title: data.title?.trim() })); } catch (error) { if (this.isNotFound(error)) throw new TopicValidationError('Topic not found.'); throw error; } }
  async setTopicContext(id: string, enabled: boolean) { try { return this.toTopic(await this.repository.updateTopicContext(id, enabled)); } catch (error) { if (this.isNotFound(error)) throw new TopicValidationError('Topic not found.'); throw error; } }
  async setNodeContext(id: string, enabled: boolean) { try { return this.toNode(await this.repository.updateNodeContext(id, enabled)); } catch (error) { if (this.isNotFound(error)) throw new TopicValidationError('Node not found.'); throw error; } }
  async archiveTopic(id: string) { return this.setTopicArchived(id, new Date()); }
  async restoreTopic(id: string) { return this.setTopicArchived(id, null); }
  private async setTopicArchived(id: string, archivedAt: Date | null) { try { return this.toTopic(await this.repository.updateTopic(id, { archivedAt })); } catch (error) { if (this.isNotFound(error)) throw new TopicValidationError('Topic not found.'); throw error; } }

  async update(id: string, data: { title?: string; systemPrompt?: string }) {
    try { return this.toConversation(await this.repository.updateConversation(id, { ...data, title: data.title?.trim() })); }
    catch (error) { if (this.isNotFound(error)) throw new ConversationNotFoundError(); throw error; }
  }

  async delete(id: string) {
    try { await this.repository.deleteConversation(id); }
    catch (error) { if (this.isNotFound(error)) throw new ConversationNotFoundError(); throw error; }
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
