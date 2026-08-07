import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeRole, type TreeMakerPreviewRequest } from '@arborai/shared';
import { MockTreeMaker, TreeMakerApplicationService, type TreeMaker, type TreeMakerNodeRecord, type TreeMakerStore, type TreeMakerTopicRecord } from './tree-maker.service.js';

const now = new Date('2026-08-06T12:00:00.000Z');
const workspaceId = 'workspace';
const topic = (id: string, overrides: Partial<TreeMakerTopicRecord> = {}): TreeMakerTopicRecord => ({
  id, conversationId: workspaceId, parentTopicId: null, title: id, description: null, activeNodeId: null,
  contextEnabled: true, archivedAt: null, contextCapsule: null, createdAt: now, ...overrides,
});
const node = (id: string, topicId: string, overrides: Partial<TreeMakerNodeRecord> = {}): TreeMakerNodeRecord => ({
  id, conversationId: workspaceId, topicId, parentId: null, role: NodeRole.User, content: 'Prior prompt', contextEnabled: true, prunedAt: null, createdAt: now, updatedAt: now, ...overrides,
});

class Store implements TreeMakerStore {
  readonly runs: Parameters<TreeMakerStore['createRun']>[0][] = [];
  constructor(readonly topics: TreeMakerTopicRecord[] = [], readonly nodes: TreeMakerNodeRecord[] = [], readonly activeTopicId: string | null = null) {}
  async findWorkspace(id: string) { return id === workspaceId ? { id, title: 'Planning', activeTopicId: this.activeTopicId } : null; }
  async listTopics() { return this.topics; }
  async listNodes() { return this.nodes; }
  async createRun(data: Parameters<TreeMakerStore['createRun']>[0]) { this.runs.push(data); return { id: `run-${this.runs.length}` }; }
}

class FixedTreeMaker implements TreeMaker {
  constructor(private readonly value: unknown) {}
  async decide() { return this.value; }
}

const preview = (service: TreeMakerApplicationService, request: Partial<TreeMakerPreviewRequest> = {}) => service.preview(workspaceId, { prompt: 'Follow up', activeTopicId: null, activeNodeId: null, ...request });

test('continues a valid active topic and records the completed decision', async () => {
  const store = new Store([topic('topic')], [node('anchor', 'topic')], 'topic');
  const result = await preview(new TreeMakerApplicationService(store), { activeTopicId: 'topic', activeNodeId: 'anchor' });
  assert.deepEqual(result.decision.action, 'continue_topic');
  assert.equal(store.runs[0].status, 'completed');
  assert.equal(store.runs[0].outputDecision.action, 'continue_topic');
});

test('routes an explicit subtopic request with medium confidence', async () => {
  const result = await preview(new TreeMakerApplicationService(new Store([topic('parent')], [], 'parent')), { prompt: 'subtopic: Error handling', activeTopicId: 'parent' });
  assert.equal(result.decision.action, 'create_subtopic');
  if (result.decision.action === 'create_subtopic') assert.equal(result.decision.parentTopicId, 'parent');
  assert.equal(result.requiresConfirmation, false);
});

test('creates an explicit independent root topic', async () => {
  const result = await preview(new TreeMakerApplicationService(new Store([topic('active')], [], 'active')), { prompt: 'root: Deployment strategy', activeTopicId: 'active' });
  assert.deepEqual(result.decision.action, 'create_root_topic');
  if (result.decision.action === 'create_root_topic') assert.equal(result.decision.title, 'Deployment strategy');
});

test('returns clarification for low-confidence routing', async () => {
  const result = await preview(new TreeMakerApplicationService(new Store([topic('topic')])), { prompt: 'ask: I am not sure which topic' });
  assert.equal(result.decision.action, 'ask_user');
  assert.equal(result.requiresConfirmation, true);
});

test('falls back when a model references a topic outside the workspace', async () => {
  const store = new Store([topic('topic')], [], 'topic');
  const result = await preview(new TreeMakerApplicationService(store, new FixedTreeMaker({ action: 'continue_topic', topicId: 'missing', anchorNodeId: null, confidence: 0.9, reasoning: 'Bad ID' })));
  assert.equal(result.decision.action, 'continue_topic');
  assert.equal(store.runs[0].status, 'fallback');
  assert.match(store.runs[0].errorMessage ?? '', /Referenced topic/);
});

test('falls back when a model references an archived topic', async () => {
  const store = new Store([topic('active'), topic('archived', { archivedAt: now })], [], 'active');
  const result = await preview(new TreeMakerApplicationService(store, new FixedTreeMaker({ action: 'continue_topic', topicId: 'archived', anchorNodeId: null, confidence: 0.9, reasoning: 'Bad archive' })));
  assert.equal(result.decision.action, 'continue_topic');
  assert.equal(store.runs[0].status, 'fallback');
});

test('rejects disabled topics and overlong generated titles', async () => {
  const disabledStore = new Store([topic('active'), topic('disabled', { contextEnabled: false })], [], 'active');
  const disabled = await preview(new TreeMakerApplicationService(disabledStore, new FixedTreeMaker({ action: 'continue_topic', topicId: 'disabled', anchorNodeId: null, confidence: 0.9, reasoning: 'Disabled candidate' })));
  assert.equal(disabledStore.runs[0].status, 'fallback');
  assert.equal(disabled.decision.action, 'continue_topic');

  const titleStore = new Store();
  await preview(new TreeMakerApplicationService(titleStore, new FixedTreeMaker({ action: 'create_root_topic', title: 'x'.repeat(201), description: null, provisionalCapsule: null, confidence: 0.9, reasoning: 'Long title' })));
  assert.equal(titleStore.runs[0].status, 'fallback');
});

test('falls back and persists a malformed model result', async () => {
  const store = new Store();
  const result = await preview(new TreeMakerApplicationService(store, new FixedTreeMaker({ action: 'continue_topic', confidence: 0.9 })));
  assert.equal(result.decision.action, 'create_root_topic');
  assert.equal(store.runs[0].status, 'fallback');
});

test('rejects invalid anchor ownership and an existing topic cycle before they can be applied', async () => {
  const cyclic = [topic('first', { parentTopicId: 'second' }), topic('second', { parentTopicId: 'first' })];
  const store = new Store(cyclic, [node('wrong-anchor', 'second')]);
  const result = await preview(new TreeMakerApplicationService(store, new FixedTreeMaker({ action: 'continue_topic', topicId: 'first', anchorNodeId: 'wrong-anchor', confidence: 0.9, reasoning: 'Invalid' })));
  assert.equal(result.decision.action, 'create_root_topic');
  assert.equal(store.runs[0].status, 'fallback');
});

test('does not mutate topics or nodes during preview', async () => {
  const topics = [topic('topic')]; const nodes = [node('anchor', 'topic')]; const store = new Store(topics, nodes, 'topic');
  await preview(new TreeMakerApplicationService(store, new MockTreeMaker()), { activeTopicId: 'topic', activeNodeId: 'anchor' });
  assert.equal(topics.length, 1);
  assert.equal(nodes.length, 1);
  assert.equal(store.runs.length, 1);
});
