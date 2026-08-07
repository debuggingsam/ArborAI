import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextExclusionReason, ContextMessageSourceType, NodeRole, type TopicContextCapsule } from '@arborai/shared';
import { ContextPreviewApplicationService, type ContextPreviewStore } from './context-preview.service.js';
import type { ContextEngineNode, ContextEngineTopic } from './context-engine.service.js';

const capsule: TopicContextCapsule = { summary: 'Compact context.', facts: [], decisions: [], constraints: [], openQuestions: [], sourceTopicIds: [], sourceNodeIds: [] };
const topic = (id: string, parentTopicId: string | null = null, overrides: Partial<ContextEngineTopic> = {}): ContextEngineTopic => ({ id, conversationId: 'workspace', parentTopicId, title: id, contextEnabled: true, archivedAt: null, contextCapsule: capsule, ...overrides });
const node = (id: string, topicId: string, overrides: Partial<ContextEngineNode> = {}): ContextEngineNode => ({ id, conversationId: 'workspace', topicId, parentId: null, role: NodeRole.User, content: id, contextEnabled: true, pinned: false, prunedAt: null, createdAt: new Date('2026-08-06T12:00:00.000Z'), ...overrides });

const preview = async (topics: ContextEngineTopic[], nodes: ContextEngineNode[], request: Partial<{ topicId: string; anchorNodeId: string | null; newPrompt: string; maxInputTokens: number }> = {}) => {
  const store: ContextPreviewStore = {
    findWorkspace: async () => ({ id: 'workspace', systemPrompt: 'System rules.' }),
    listTopics: async () => topics,
    listNodes: async () => nodes,
  };
  return new ContextPreviewApplicationService(store).preview('workspace', { topicId: request.topicId ?? 'root', anchorNodeId: request.anchorNodeId ?? null, newPrompt: request.newPrompt ?? 'New prompt.', ...(request.maxInputTokens === undefined ? {} : { maxInputTokens: request.maxInputTokens }) });
};

test('context preview isolates independent root topics and retains ordered source metadata', async () => {
  const result = await preview([topic('root'), topic('other')], [node('other-node', 'other')]);
  assert.deepEqual(result.messages.map((message) => [message.sourceType, message.sourceId]), [
    [ContextMessageSourceType.WorkspaceSystemPrompt, null],
    [ContextMessageSourceType.TopicCapsule, 'root'],
    [ContextMessageSourceType.NewPrompt, null],
  ]);
  assert.deepEqual(result.exclusions, [{ targetType: 'topic', targetId: 'other', reason: ContextExclusionReason.UnrelatedRootTopic }]);
});

test('context preview inherits enabled subtopic lineage capsules and selected message path', async () => {
  const result = await preview([topic('root'), topic('child', 'root')], [node('first', 'child'), node('anchor', 'child', { parentId: 'first', role: NodeRole.Assistant })], { topicId: 'child', anchorNodeId: 'anchor' });
  assert.deepEqual(result.includedTopicIds, ['root', 'child']);
  assert.deepEqual(result.includedNodeIds, ['first', 'anchor']);
});

test('context preview rejects a disabled target topic without writing graph state', async () => {
  const topics = [topic('root', null, { contextEnabled: false })];
  const nodes = [node('anchor', 'root')];
  await assert.rejects(() => preview(topics, nodes, { anchorNodeId: 'anchor' }), /context-disabled/);
  assert.equal(topics[0]!.contextEnabled, false);
  assert.equal(nodes[0]!.content, 'anchor');
});

test('context preview excludes disabled selected messages and reports a context gap', async () => {
  const result = await preview([topic('root')], [node('disabled', 'root', { contextEnabled: false }), node('anchor', 'root', { parentId: 'disabled', role: NodeRole.Assistant })], { anchorNodeId: 'anchor' });
  assert.deepEqual(result.includedNodeIds, ['anchor']);
  assert.ok(result.exclusions.some((item) => item.targetId === 'disabled' && item.reason === ContextExclusionReason.MessageContextDisabled));
  assert.ok(result.warnings.some((item) => item.code === 'context_gap' && item.nodeId === 'disabled'));
});

test('context preview excludes alternative branches outside the selected path', async () => {
  const result = await preview([topic('root')], [node('user', 'root'), node('selected', 'root', { parentId: 'user', role: NodeRole.Assistant }), node('alternative', 'root', { parentId: 'user', role: NodeRole.Assistant })], { anchorNodeId: 'selected' });
  assert.deepEqual(result.includedNodeIds, ['user', 'selected']);
  assert.ok(result.exclusions.some((item) => item.targetId === 'alternative' && item.reason === ContextExclusionReason.AlternativeBranchNotSelected));
});

test('context preview reports token-trimmed nodes', async () => {
  const result = await preview([topic('root', null, { contextCapsule: null })], [node('old', 'root', { content: '12345', createdAt: new Date('2026-08-06T10:00:00.000Z') }), node('anchor', 'root', { parentId: 'old', content: '67890', createdAt: new Date('2026-08-06T11:00:00.000Z') })], { anchorNodeId: 'anchor', maxInputTokens: 7 });
  assert.deepEqual(result.trimmedNodeIds, ['old', 'anchor']);
  assert.ok(result.exclusions.some((item) => item.targetId === 'old' && item.reason === ContextExclusionReason.TokenBudget));
});
