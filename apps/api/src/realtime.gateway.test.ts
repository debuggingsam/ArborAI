import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RealtimeGateway } from './realtime.gateway.js';

class FakeSocket extends EventEmitter { destroyed = false; writes: Buffer[] = []; write(data: Buffer | string) { this.writes.push(Buffer.isBuffer(data) ? data : Buffer.from(data)); return true; } destroy() { this.destroyed = true; } }
function clientFrame(value: unknown) { const text = Buffer.from(JSON.stringify(value)); const mask = Buffer.from([1, 2, 3, 4]); const encoded = Buffer.alloc(6 + text.length); encoded[0] = 0x81; encoded[1] = 0x80 | text.length; mask.copy(encoded, 2); for (let i = 0; i < text.length; i += 1) encoded[6 + i] = text[i]! ^ mask[i % 4]!; return encoded; }
function payload(socket: FakeSocket) { const frame = socket.writes.at(-1)!; const offset = frame[1]! === 126 ? 4 : 2; return JSON.parse(frame.subarray(offset).toString()); }

test('two joined workspace clients receive the same centralized event envelope', () => {
  let upgrade: ((request: any, socket: any) => void) | undefined;
  const server = { on(_event: 'upgrade', listener: (request: any, socket: any) => void) { upgrade = listener; } };
  const gateway = new RealtimeGateway(); gateway.attach(server, '/ws');
  const first = new FakeSocket(); const second = new FakeSocket(); const request = { url: '/ws', headers: { upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } };
  upgrade!(request, first); upgrade!(request, second);
  first.emit('data', clientFrame({ eventType: 'conversation.join', workspaceId: 'workspace' })); second.emit('data', clientFrame({ eventType: 'conversation.join', workspaceId: 'workspace' }));
  gateway.publish('workspace', 'generation', { eventType: 'assistant.delta', assistantNodeId: 'assistant', delta: 'hello ' });
  const a = payload(first); const b = payload(second);
  assert.equal(a.eventType, 'assistant.delta'); assert.deepEqual(a.payload, b.payload); assert.equal(a.workspaceId, b.workspaceId); assert.equal(a.generationId, b.generationId);
});
