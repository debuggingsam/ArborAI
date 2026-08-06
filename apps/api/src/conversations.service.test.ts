import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationService, TopicValidationError } from './conversations.service.js';

const topic = (id: string, conversationId: string, parentTopicId: string | null = null) => ({
  id,
  conversationId,
  parentTopicId,
  title: id,
  description: null,
  activeNodeId: null,
  contextEnabled: true,
  archivedAt: null,
  contextCapsule: null,
  capsuleVersion: 0,
  capsuleUpdatedAt: null,
  createdBy: 'user',
  createdAt: new Date(),
  updatedAt: new Date(),
});

test('rejects moving a topic below one of its descendants', async () => {
  const topics = new Map([
    ['parent', topic('parent', 'workspace')],
    ['child', topic('child', 'workspace', 'parent')],
  ]);
  const db = { topic: { findUnique: async ({ where: { id } }: { where: { id: string } }) => topics.get(id) } } as never;
  const service = new ConversationService(db);
  await assert.rejects(() => service.moveTopic('parent', 'child'), TopicValidationError);
});

test('rejects an active node owned by another topic', async () => {
  const db = {
    topic: { findUnique: async () => topic('topic', 'workspace') },
    conversationNode: { findUnique: async () => ({ conversationId: 'workspace', topicId: 'other-topic', prunedAt: null }) },
  } as never;
  const service = new ConversationService(db);
  await assert.rejects(() => service.setTopicActiveNode('topic', 'node'), /visible message in the topic/);
});
