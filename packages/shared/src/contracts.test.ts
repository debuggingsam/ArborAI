import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextPreviewRequestSchema, GenerationRequestSchema, NodeRole, NodeStatus, TreeMakerDecisionSchema, TreeMakerInputSchema, WebSocketEvent, WebSocketEventEnvelopeSchema, validateCreateConversationRequest, validateMoveTopicRequest, validatePinRequest, validateStartGenerationRequest, validateUpdateTopicRequest } from './index.js';

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

test('validates topic moves, metadata updates, and node pin state', () => {
  assert.equal(validateMoveTopicRequest({ parentTopicId: null }).success, true);
  assert.equal(validateMoveTopicRequest({}).success, false);
  assert.equal(validateUpdateTopicRequest({ title: 'Renamed topic' }).success, true);
  assert.equal(validateUpdateTopicRequest({}).success, false);
  assert.equal(validatePinRequest({ pinned: true }).success, true);
  assert.equal(validatePinRequest({ pinned: 'true' }).success, false);
});

test('validates each generation mode and rejects a malformed discriminated member', () => {
  const examples = [
    { mode: 'auto_route', prompt: 'Follow up', activeTopicId: 'topic', activeNodeId: null },
    { mode: 'manual_continue', prompt: 'Follow up', topicId: 'topic', anchorNodeId: null },
    { mode: 'manual_subtopic', prompt: 'Detail', parentTopicId: 'topic', title: 'Detail' },
    { mode: 'manual_root_topic', prompt: 'New subject' },
    { mode: 'regenerate', userNodeId: 'node' },
  ];
  for (const example of examples) assert.equal(GenerationRequestSchema.safeParse(example).success, true);
  assert.equal(GenerationRequestSchema.safeParse({ mode: 'manual_continue', prompt: 'Follow up' }).success, false);
});

test('validates the TreeMaker decision union at runtime', () => {
  const valid = TreeMakerDecisionSchema.safeParse({ action: 'continue_topic', topicId: 'topic', anchorNodeId: 'node', confidence: 0.9, reasoning: 'Direct follow-up' });
  assert.equal(valid.success, true);
  assert.equal(TreeMakerDecisionSchema.safeParse({ action: 'continue_topic', topicId: 'topic', confidence: 1.4, reasoning: 'Bad confidence' }).success, false);
});

test('validates the bounded TreeMaker input index without transcript fields', () => {
  const input = {
    workspace: { id: 'workspace', title: 'Planning' }, activeTopicId: 'topic', activeNodeId: 'node', newPrompt: 'Follow up',
    topics: [{ id: 'topic', parentTopicId: null, title: 'Topic', description: null, capsuleSummary: null, recentActivity: null, contextEnabled: true, archived: false, childTopicCount: 0, messageCount: 1 }],
    recentMessagesByTopic: { topic: [{ id: 'node', role: 'user', contentPreview: 'Short preview' }] },
  };
  assert.equal(TreeMakerInputSchema.safeParse(input).success, true);
  assert.equal(TreeMakerInputSchema.safeParse({ ...input, topics: [{ ...input.topics[0], childTopicCount: -1 }] }).success, false);
});

test('validates context previews and rejects malformed realtime envelopes', () => {
  assert.equal(ContextPreviewRequestSchema.safeParse({ topicId: 'topic', anchorNodeId: null, newPrompt: 'What next?', maxInputTokens: 100 }).success, true);
  assert.equal(ContextPreviewRequestSchema.safeParse({ topicId: 'topic', anchorNodeId: null, newPrompt: 'What next?', maxInputTokens: 0 }).success, false);
  const valid = { eventId: 'event', eventType: WebSocketEvent.AssistantDelta, workspaceId: 'workspace', generationId: 'generation', occurredAt: '2026-08-06T00:00:00.000Z', payload: { eventType: WebSocketEvent.AssistantDelta, assistantNodeId: 'node', delta: 'Hello' } };
  assert.equal(WebSocketEventEnvelopeSchema.safeParse(valid).success, true);
  assert.equal(WebSocketEventEnvelopeSchema.safeParse({ ...valid, payload: { eventType: WebSocketEvent.AssistantDelta, assistantNodeId: 'node' } }).success, false);
});
