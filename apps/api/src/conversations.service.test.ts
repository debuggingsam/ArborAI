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
  archivedAt: null as Date | null,
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

test('excludes archived topics, their descendants, and their nodes from a workspace graph', async () => {
  const topics = [topic('visible', 'workspace'), topic('archived', 'workspace'), topic('hidden-child', 'workspace', 'archived')];
  topics[1].archivedAt = new Date();
  const node = { id: 'node', conversationId: 'workspace', topicId: 'hidden-child', parentId: null, role: 'user', content: 'hidden', status: 'completed', tokenCount: null, contextEnabled: true, pinned: false, errorMessage: null, prunedAt: null, createdAt: new Date(), updatedAt: new Date() };
  const db = {
    conversation: { findUnique: async () => ({ id: 'workspace', title: 'Workspace', systemPrompt: null, activeTopicId: 'hidden-child', createdAt: new Date(), updatedAt: new Date() }) },
    topic: { findMany: async () => topics },
    conversationNode: { findMany: async () => [node] },
  } as never;
  const graph = await new ConversationService(db).get('workspace');
  assert.deepEqual(graph.topics.map(({ id }) => id), ['visible']);
  assert.deepEqual(graph.nodes, []);
  assert.equal(graph.activeTopicId, null);
});

test('rejects an archived topic as a new parent', async () => {
  const archivedParent = topic('parent', 'workspace');
  archivedParent.archivedAt = new Date();
  const db = {
    conversation: { findUnique: async () => ({ id: 'workspace' }) },
    topic: { findUnique: async () => archivedParent },
  } as never;
  await assert.rejects(
    () => new ConversationService(db).createTopic('workspace', { title: 'Child', parentTopicId: 'parent' }),
    /Archived topics cannot be parents/,
  );
});
