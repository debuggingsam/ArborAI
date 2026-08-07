import { TopicContextCapsuleSchema, type TopicContextCapsule } from '@arborai/shared';
import { ConversationRepository } from './repositories/conversation.repository.js';
import type { CapsuleTopicRecord, ContextCapsuleStore } from './context-capsule.service.js';

/** Prisma adapter for the capsule service's small persistence port. */
export class PrismaContextCapsuleStore implements ContextCapsuleStore {
  constructor(private readonly repository: ConversationRepository) {}

  async findTopic(id: string): Promise<CapsuleTopicRecord | null> {
    const topic = await this.repository.findTopic(id);
    return topic ? toRecord(topic) : null;
  }

  async listTopics(workspaceId: string): Promise<CapsuleTopicRecord[]> {
    return (await this.repository.listTopics(workspaceId)).map(toRecord);
  }

  async saveCapsule(topicId: string, capsule: TopicContextCapsule): Promise<void> {
    await this.repository.updateTopic(topicId, {
      contextCapsule: capsule,
      capsuleVersion: { increment: 1 },
      capsuleUpdatedAt: new Date(),
    });
  }
}

function toRecord(topic: {
  id: string; conversationId: string; parentTopicId: string | null; title: string; description: string | null;
  contextCapsule: unknown; capsuleVersion: number;
}): CapsuleTopicRecord {
  const parsed = TopicContextCapsuleSchema.safeParse(topic.contextCapsule);
  return {
    id: topic.id, conversationId: topic.conversationId, parentTopicId: topic.parentTopicId,
    title: topic.title, description: topic.description, contextCapsule: parsed.success ? parsed.data : null,
    capsuleVersion: topic.capsuleVersion,
  };
}
