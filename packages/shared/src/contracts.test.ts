import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeRole, NodeStatus, WebSocketEvent, validateCreateConversationRequest, validateStartGenerationRequest } from './index.js';

test('exports stable node and WebSocket contract values', () => {
  assert.equal(NodeRole.Assistant, 'assistant');
  assert.equal(NodeStatus.Streaming, 'streaming');
  assert.equal(WebSocketEvent.AssistantDelta, 'assistant.delta');
});

test('validates representative external request payloads', () => {
  const result = validateStartGenerationRequest({ conversationId: 'c1', parentNodeId: null, content: 'Hello' });
  assert.deepEqual(result, { success: true, data: { conversationId: 'c1', parentNodeId: null, content: 'Hello' } });
});

test('rejects malformed external request payloads', () => {
  const result = validateCreateConversationRequest({ title: '', systemPrompt: 42 });
  assert.equal(result.success, false);
  if (!result.success) assert.deepEqual(result.errors, ['title must be a non-empty string', 'systemPrompt must be a string when provided']);
});
