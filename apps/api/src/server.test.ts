import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApiRequest } from './server.js';

const topicId = '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000002';
const request = (method: string, url: string, body?: unknown) => {
  const payload = body === undefined ? [] : [JSON.stringify(body)];
  return Object.assign((async function* () { yield* payload; })(), { method, url }) as never;
};
const response = () => {
  const body: string[] = [];
  let status = 0;
  return { response: { setHeader() {}, writeHead(value: number) { status = value; return this; }, end(value?: string) { if (value) body.push(value); } } as never, result: () => ({ status, body: body[0] ? JSON.parse(body[0]) : undefined }) };
};

test('GET /health returns a status payload', async () => {
  const body: string[] = [];
  const response = { setHeader() {}, writeHead() { return this; }, end(value: string) { body.push(value); } } as never;
  handleApiRequest({ port: 3001, webOrigin: 'http://localhost:3000', aiProvider: 'mock', wsPath: '/ws' }, { method: 'GET', url: '/health' } as never, response);
  assert.deepEqual(JSON.parse(body[0]), { status: 'ok' });
});

test('workspace and topic mutation routes dispatch validated operations', async () => {
  const calls: unknown[] = [];
  const service = {
    moveTopic: async (...args: unknown[]) => { calls.push(['move', ...args]); return { id: topicId }; },
    setNodePinned: async (...args: unknown[]) => { calls.push(['pin', ...args]); return { id: 'node' }; },
  } as never;
  const config = { port: 3001, webOrigin: 'http://localhost:3000', aiProvider: 'mock', wsPath: '/ws' };
  const move = response();
  await handleApiRequest(config, request('POST', `/topics/${topicId}/move`, { parentTopicId: null }), move.response, { conversations: service });
  assert.equal(move.result().status, 200);
  const pin = response();
  await handleApiRequest(config, request('PATCH', '/nodes/00000000-0000-4000-8000-000000000003/pin', { pinned: true }), pin.response, { conversations: service });
  assert.equal(pin.result().status, 200);
  assert.deepEqual(calls, [['move', topicId, null], ['pin', '00000000-0000-4000-8000-000000000003', true]]);
});

test('workspace graph response uses workspace terminology', async () => {
  const graph = { conversation: { id: workspaceId }, topics: [], nodes: [], activeTopicId: null };
  const result = response();
  await handleApiRequest(
    { port: 3001, webOrigin: 'http://localhost:3000', aiProvider: 'mock', wsPath: '/ws' },
    request('GET', `/workspaces/${workspaceId}`),
    result.response,
    { conversations: { get: async () => graph } as never },
  );
  assert.deepEqual(result.result(), { status: 200, body: { workspace: { id: workspaceId }, topics: [], nodes: [], activeTopicId: null } });
});

test('TreeMaker preview dispatches without graph mutations', async () => {
  const calls: unknown[] = [];
  const result = response();
  await handleApiRequest(
    { port: 3001, webOrigin: 'http://localhost:3000', aiProvider: 'mock', wsPath: '/ws' },
    request('POST', `/workspaces/${workspaceId}/tree-maker/preview`, { prompt: 'Follow up', activeTopicId: null, activeNodeId: null }),
    result.response,
    { conversations: {} as never, treeMaker: { preview: async (...args: unknown[]) => { calls.push(args); return { decision: { action: 'ask_user' }, requiresConfirmation: true }; } } as never },
  );
  assert.equal(result.result().status, 200);
  assert.deepEqual(calls, [[workspaceId, { prompt: 'Follow up', activeTopicId: null, activeNodeId: null }]]);
});

test('context preview dispatches a validated read-only request', async () => {
  const calls: unknown[] = [];
  const result = response();
  await handleApiRequest(
    { port: 3001, webOrigin: 'http://localhost:3000', aiProvider: 'mock', wsPath: '/ws' },
    request('POST', `/workspaces/${workspaceId}/context-preview`, { topicId, anchorNodeId: null, newPrompt: 'Follow up', maxInputTokens: 100 }),
    result.response,
    { conversations: {} as never, contextPreview: { preview: async (...args: unknown[]) => { calls.push(args); return { messages: [], includedTopicIds: [], includedNodeIds: [], excludedTopicIds: [], excludedNodeIds: [], exclusions: [], warnings: [], trimmedNodeIds: [], estimatedInputTokens: 0, maxInputTokens: 100 }; } } as never },
  );
  assert.equal(result.result().status, 200);
  assert.deepEqual(calls, [[workspaceId, { topicId, anchorNodeId: null, newPrompt: 'Follow up', maxInputTokens: 100 }]]);
});

test('context preview returns predictable validation errors', async () => {
  const result = response();
  await handleApiRequest(
    { port: 3001, webOrigin: 'http://localhost:3000', aiProvider: 'mock', wsPath: '/ws' },
    request('POST', `/workspaces/${workspaceId}/context-preview`, { topicId: '', anchorNodeId: null, newPrompt: '', maxInputTokens: 0 }),
    result.response,
    { conversations: {} as never, contextPreview: {} as never },
  );
  assert.deepEqual(result.result(), { status: 400, body: { error: { code: 'validation_error', message: 'Invalid context preview payload.', details: ['topicId must be a non-empty string', 'newPrompt must be a non-empty string', 'maxInputTokens must be a positive integer when provided'] } } });
});

test('comparison dispatches two validated graph selections without mutation', async () => {
  const calls: unknown[] = [];
  const result = response();
  await handleApiRequest(
    { port: 3001, webOrigin: 'http://localhost:3000', aiProvider: 'mock', wsPath: '/ws' },
    request('POST', `/workspaces/${workspaceId}/comparison`, { left: { type: 'topic', id: 'left' }, right: { type: 'node', id: 'right' } }),
    result.response,
    { conversations: {} as never, comparisons: { compare: async (...args: unknown[]) => { calls.push(args); return { workspaceId, sharedTopicPathIds: [], sharedMessagePathIds: [] }; } } as never },
  );
  assert.equal(result.result().status, 200);
  assert.deepEqual(calls, [[workspaceId, { left: { type: 'topic', id: 'left' }, right: { type: 'node', id: 'right' } }]]);
});

test('prune and archived-topic routes dispatch correction operations', async () => {
  const calls: unknown[] = [];
  const service = {
    pruneNode: async (...args: unknown[]) => { calls.push(['prune', ...args]); return { prunedNodeCount: 2 }; },
    archivedTopics: async (...args: unknown[]) => { calls.push(['archived', ...args]); return []; },
  } as never;
  const config = { port: 3001, webOrigin: 'http://localhost:3000', aiProvider: 'mock', wsPath: '/ws' };
  const prune = response();
  await handleApiRequest(config, request('POST', '/nodes/00000000-0000-4000-8000-000000000003/prune', {}), prune.response, { conversations: service });
  assert.equal(prune.result().status, 200);
  const archived = response();
  await handleApiRequest(config, request('GET', `/workspaces/${workspaceId}/archived-topics`), archived.response, { conversations: service });
  assert.deepEqual(archived.result().body, { topics: [] });
  assert.deepEqual(calls, [['prune', '00000000-0000-4000-8000-000000000003'], ['archived', workspaceId]]);
});
