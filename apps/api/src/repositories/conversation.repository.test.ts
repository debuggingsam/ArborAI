import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationRepository } from './conversation.repository.js';

test('rejects a node parent from another conversation', async () => {
  const db = { conversationNode: { findUnique: async () => ({ conversationId: 'other', topicId: 'topic' }), create: async () => undefined } } as never;
  await assert.rejects(() => new ConversationRepository(db).createNode({ conversationId: 'current', topicId: 'topic', parentId: 'parent', role: 'user', content: 'x', status: 'pending' }), /another conversation/);
});

test('active node queries exclude pruned nodes', async () => {
  let query: unknown;
  const db = { conversationNode: { findMany: async (args: unknown) => { query = args; return []; } } } as never;
  await new ConversationRepository(db).listActiveNodes('conversation');
  assert.deepEqual(query, { where: { conversationId: 'conversation', prunedAt: null }, orderBy: { createdAt: 'asc' } });
});
