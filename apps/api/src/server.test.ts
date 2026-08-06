import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApiRequest } from './server.js';

test('GET /health returns a status payload', async () => {
  const body: string[] = [];
  const response = { setHeader() {}, writeHead() { return this; }, end(value: string) { body.push(value); } } as never;
  handleApiRequest({ port: 3001, webOrigin: 'http://localhost:3000', aiProvider: 'mock', wsPath: '/ws' }, { method: 'GET', url: '/health' } as never, response);
  assert.deepEqual(JSON.parse(body[0]), { status: 'ok' });
});
