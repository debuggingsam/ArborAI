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

test('rejects a node whose topic belongs to another conversation', async () => {
  const db = {
    conversationNode: { create: async () => undefined },
    topic: { findUnique: async () => ({ conversationId: 'other' }) },
  } as never;
  await assert.rejects(
    () => new ConversationRepository(db).createNode({ conversationId: 'current', topicId: 'topic', parentId: null, role: 'user', content: 'x', status: 'pending' }),
    /Topic belongs to another conversation/,
  );
});

test('rejects a node parent from another topic', async () => {
  const db = {
    conversationNode: { findUnique: async () => ({ conversationId: 'current', topicId: 'other-topic' }), create: async () => undefined },
  } as never;
  await assert.rejects(
    () => new ConversationRepository(db).createNode({ conversationId: 'current', topicId: 'topic', parentId: 'parent', role: 'user', content: 'x', status: 'pending' }),
    /another topic/,
  );
});

test('persists TreeMaker decisions and immutable context snapshots through create-only helpers', async () => {
  let treeMakerRunData: unknown;
  let generationData: unknown;
  let snapshotData: unknown;
  const db = {
    treeMakerRun: { create: async ({ data }: { data: unknown }) => { treeMakerRunData = data; return data; } },
    generation: { create: async ({ data }: { data: unknown }) => { generationData = data; return data; } },
    generationContextSnapshot: { create: async ({ data }: { data: unknown }) => { snapshotData = data; return data; } },
  } as never;
  const repository = new ConversationRepository(db);
  const decision = { action: 'continue_topic', topicId: 'topic', confidence: 0.9 };
  await repository.createTreeMakerRun({ conversationId: 'workspace', newPrompt: 'Follow up', inputTreeIndex: { topics: [] }, outputDecision: decision, provider: 'mock', model: 'mock-tree-maker', confidence: 0.9, status: 'completed' });
  await repository.createGeneration({ conversationId: 'workspace', topicId: 'topic', treeMakerRunId: 'tree-maker-run', userNodeId: 'user-node', assistantNodeId: 'assistant-node', mode: 'auto_route', provider: 'mock', model: 'mock-answer', status: 'pending' });
  await repository.createGenerationContextSnapshot({ generationId: 'generation', orderedModelMessages: [{ role: 'user', content: 'Follow up', sourceType: 'new_prompt', sourceId: null }], includedTopicIds: ['topic'], includedNodeIds: [], excludedTopicIds: [], excludedNodeIds: [], exclusions: [], warnings: [], estimatedInputTokens: 2, maxInputTokens: 100 });
  assert.deepEqual(treeMakerRunData, { conversationId: 'workspace', newPrompt: 'Follow up', inputTreeIndex: { topics: [] }, outputDecision: decision, provider: 'mock', model: 'mock-tree-maker', confidence: 0.9, status: 'completed' });
  assert.deepEqual(generationData, { conversationId: 'workspace', topicId: 'topic', treeMakerRunId: 'tree-maker-run', userNodeId: 'user-node', assistantNodeId: 'assistant-node', mode: 'auto_route', provider: 'mock', model: 'mock-answer', status: 'pending' });
  assert.deepEqual(snapshotData, { generationId: 'generation', orderedModelMessages: [{ role: 'user', content: 'Follow up', sourceType: 'new_prompt', sourceId: null }], includedTopicIds: ['topic'], includedNodeIds: [], excludedTopicIds: [], excludedNodeIds: [], exclusions: [], warnings: [], estimatedInputTokens: 2, maxInputTokens: 100 });
});
