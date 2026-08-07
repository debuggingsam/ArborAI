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
