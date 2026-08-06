import type { PrismaClient, Prisma } from '@prisma/client';
import { ConversationRepository } from './repositories/conversation.repository.js';

export class ConversationNotFoundError extends Error {}

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
    const nodes = await this.repository.listActiveNodes(id);
    return { conversation: this.toConversation(conversation), nodes: nodes.map((node) => this.toNode(node)) };
  }

  async update(id: string, data: { title?: string; systemPrompt?: string }) {
    try { return this.toConversation(await this.repository.updateConversation(id, { ...data, title: data.title?.trim() })); }
    catch (error) { if (this.isNotFound(error)) throw new ConversationNotFoundError(); throw error; }
  }

  async delete(id: string) {
    try { await this.repository.deleteConversation(id); }
    catch (error) { if (this.isNotFound(error)) throw new ConversationNotFoundError(); throw error; }
  }

  private toConversation(value: { id: string; title: string; systemPrompt: string | null; activeNodeId: string | null; createdAt: Date; updatedAt: Date }) {
    return { id: value.id, title: value.title, systemPrompt: value.systemPrompt ?? '', activeNodeId: value.activeNodeId, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() };
  }
  private toNode(value: Prisma.ConversationNodeGetPayload<{}>) {
    return { ...value, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(), prunedAt: value.prunedAt?.toISOString() ?? null };
  }
  private isNotFound(error: unknown) { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025'; }
}
