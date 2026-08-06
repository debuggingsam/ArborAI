import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationApi } from './conversations-client.js';

test('conversation client uses the conversation REST contract', async () => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const request = async (url: string, init?: RequestInit) => { calls.push([url, init]); return new Response(JSON.stringify({ id: '1', title: 'Test', updatedAt: 'now' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  await createConversationApi('http://api/', request as typeof fetch).create('Test');
  assert.equal(calls[0][0], 'http://api/conversations');
  assert.equal(calls[0][1]?.method, 'POST');
  assert.equal(calls[0][1]?.body, JSON.stringify({ title: 'Test' }));
});
