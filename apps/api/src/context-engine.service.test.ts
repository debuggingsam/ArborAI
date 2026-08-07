import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextExclusionReason, ContextMessageSourceType, ContextWarningCode, NodeRole, type TopicContextCapsule } from '@arborai/shared';
import { ContextEngine, ContextEngineValidationError, type ContextEngineNode, type ContextEngineTopic } from './context-engine.service.js';

const now = new Date('2026-08-06T12:00:00.000Z');
const capsule: TopicContextCapsule = { summary: 'Capsule summary.', facts: [], decisions: [], constraints: [], openQuestions: [], sourceTopicIds: [], sourceNodeIds: [] };
const topic = (id: string, parentTopicId: string | null = null, overrides: Partial<ContextEngineTopic> = {}): ContextEngineTopic => ({ id, conversationId: 'workspace', parentTopicId, title: id, contextEnabled: true, archivedAt: null, contextCapsule: capsule, ...overrides });
const node = (id: string, topicId: string, overrides: Partial<ContextEngineNode> = {}): ContextEngineNode => ({ id, conversationId: 'workspace', topicId, parentId: null, role: NodeRole.User, content: id, contextEnabled: true, pinned: false, prunedAt: null, createdAt: now, ...overrides });
const assemble = (topics: ContextEngineTopic[], nodes: ContextEngineNode[] = [], options: Partial<{ topicId: string; anchorNodeId: string | null; newPrompt: string; maxInputTokens: number }> = {}) => new ContextEngine().assemble({ workspace: { id: 'workspace', systemPrompt: 'System rules.' }, topics, nodes, topicId: options.topicId ?? 'root', anchorNodeId: options.anchorNodeId ?? 'anchor', newPrompt: options.newPrompt ?? 'New prompt.', maxInputTokens: options.maxInputTokens });

test('assembles a linear topic in the required model-message order', () => {
  const result = assemble([topic('root')], [node('first', 'root'), node('anchor', 'root', { parentId: 'first', role: NodeRole.Assistant })]);
  assert.deepEqual(result.messages, [
    { role: 'system', content: 'System rules.', sourceType: ContextMessageSourceType.WorkspaceSystemPrompt, sourceId: null },
    { role: 'system', content: 'Topic context: root\nCapsule summary.', sourceType: ContextMessageSourceType.TopicCapsule, sourceId: 'root' },
    { role: 'user', content: 'first', sourceType: ContextMessageSourceType.MessageNode, sourceId: 'first' },
    { role: 'assistant', content: 'anchor', sourceType: ContextMessageSourceType.MessageNode, sourceId: 'anchor' },
    { role: 'user', content: 'New prompt.', sourceType: ContextMessageSourceType.NewPrompt, sourceId: null },
  ]);
  assert.deepEqual(result.includedTopicIds, ['root']);
  assert.deepEqual(result.includedNodeIds, ['first', 'anchor']);
});

test('isolates multiple roots and sibling topics', () => {
  const result = assemble([topic('root'), topic('child', 'root'), topic('sibling', 'root'), topic('other')], [], { topicId: 'child', anchorNodeId: null });
  assert.deepEqual(result.includedTopicIds, ['root', 'child']);
  assert.deepEqual(result.exclusions, [
    { targetType: 'topic', targetId: 'other', reason: ContextExclusionReason.UnrelatedRootTopic },
    { targetType: 'topic', targetId: 'sibling', reason: ContextExclusionReason.SiblingTopic },
  ]);
});

test('includes only the selected alternative path', () => {
  const result = assemble([topic('root')], [
    node('user', 'root'), node('selected', 'root', { parentId: 'user', role: NodeRole.Assistant }),
    node('alternative', 'root', { parentId: 'user', role: NodeRole.Assistant }), node('later', 'root', { parentId: 'selected' }),
  ], { anchorNodeId: 'later' });
  assert.deepEqual(result.includedNodeIds, ['user', 'selected', 'later']);
  assert.deepEqual(result.exclusions, [{ targetType: 'node', targetId: 'alternative', reason: ContextExclusionReason.AlternativeBranchNotSelected }]);
});

test('rejects an active topic disabled directly or by an ancestor', () => {
  assert.throws(() => assemble([topic('root', null, { contextEnabled: false })], [], { anchorNodeId: null }), ContextEngineValidationError);
  assert.throws(() => assemble([topic('root', null, { contextEnabled: false }), topic('child', 'root')], [], { topicId: 'child', anchorNodeId: null }), ContextEngineValidationError);
});

test('omits disabled selected messages and warns about the resulting context gap', () => {
  const result = assemble([topic('root')], [node('disabled', 'root', { contextEnabled: false }), node('anchor', 'root', { parentId: 'disabled', role: NodeRole.Assistant })]);
  assert.deepEqual(result.includedNodeIds, ['anchor']);
  assert.ok(result.exclusions.some((item) => item.targetId === 'disabled' && item.reason === ContextExclusionReason.MessageContextDisabled));
  assert.ok(result.warnings.some((item) => item.code === ContextWarningCode.ContextGap && item.nodeId === 'disabled'));
});

test('adds eligible pinned lineage messages once before the active path', () => {
  const result = assemble([topic('root'), topic('child', 'root')], [node('pinned', 'root', { pinned: true }), node('path', 'child'), node('anchor', 'child', { parentId: 'path', role: NodeRole.Assistant, pinned: true })], { topicId: 'child' });
  assert.deepEqual(result.includedNodeIds, ['pinned', 'path', 'anchor']);
  assert.equal(result.includedNodeIds.filter((id) => id === 'anchor').length, 1);
});

test('excludes pruned active-topic messages with a context gap warning', () => {
  const result = assemble([topic('root')], [node('pruned', 'root', { prunedAt: now }), node('anchor', 'root', { parentId: 'pruned', role: NodeRole.Assistant })]);
  assert.ok(result.exclusions.some((item) => item.targetId === 'pruned' && item.reason === ContextExclusionReason.MessagePruned));
  assert.ok(result.warnings.some((item) => item.code === ContextWarningCode.ContextGap));
});

test('excludes archived topics and descendants', () => {
  const result = assemble([topic('root'), topic('archived', null, { archivedAt: now }), topic('hidden', 'archived')], [], { anchorNodeId: null });
  assert.deepEqual(result.exclusions, [
    { targetType: 'topic', targetId: 'archived', reason: ContextExclusionReason.TopicArchived },
    { targetType: 'topic', targetId: 'hidden', reason: ContextExclusionReason.TopicArchived },
  ]);
});

test('detects topic and message cycles', () => {
  assert.throws(() => assemble([topic('root', 'child'), topic('child', 'root')], [], { anchorNodeId: null }), /cycle/);
  assert.throws(() => assemble([topic('root')], [node('anchor', 'root', { parentId: 'other' }), node('other', 'root', { parentId: 'anchor' })]), /cycle/);
});

test('trims oldest removable nodes after selection while preserving required context', () => {
  const engine = new ContextEngine((messages) => messages.reduce((sum, message) => sum + message.content.length, 0));
  const result = engine.assemble({ workspace: { id: 'workspace', systemPrompt: 's' }, topics: [topic('root', null, { contextCapsule: null })], nodes: [node('old', 'root', { content: '12345', createdAt: new Date('2026-08-06T10:00:00.000Z') }), node('anchor', 'root', { parentId: 'old', content: '67890', createdAt: new Date('2026-08-06T11:00:00.000Z') })], topicId: 'root', anchorNodeId: 'anchor', newPrompt: 'p', maxInputTokens: 7 });
  assert.deepEqual(result.trimmedNodeIds, ['old']);
  assert.deepEqual(result.includedNodeIds, ['anchor']);
  assert.ok(result.exclusions.some((item) => item.targetId === 'old' && item.reason === ContextExclusionReason.TokenBudget));
});

test('reports an empty topic and missing capsule without synthesizing transcript context', () => {
  const result = assemble([topic('root', null, { contextCapsule: null })], [], { anchorNodeId: null });
  assert.deepEqual(result.includedNodeIds, []);
  assert.ok(result.warnings.some((item) => item.code === ContextWarningCode.CapsuleMissing && item.topicId === 'root'));
  assert.deepEqual(result.messages, [
    { role: 'system', content: 'System rules.', sourceType: ContextMessageSourceType.WorkspaceSystemPrompt, sourceId: null },
    { role: 'user', content: 'New prompt.', sourceType: ContextMessageSourceType.NewPrompt, sourceId: null },
  ]);
});

test('warns when the budget cannot fit required context', () => {
  const result = assemble([topic('root')], [], { anchorNodeId: null, maxInputTokens: 1 });
  assert.ok(result.warnings.some((item) => item.code === ContextWarningCode.TokenBudgetTooSmall));
  assert.ok(result.estimatedInputTokens > 1);
});
