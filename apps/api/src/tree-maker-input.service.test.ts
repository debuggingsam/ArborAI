import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeRole, type TopicContextCapsule } from '@arborai/shared';
import { buildTreeMakerInput, type TreeMakerInputNode, type TreeMakerInputTopic } from './tree-maker-input.service.js';

const now = new Date('2026-08-06T12:00:00.000Z');
const capsule: TopicContextCapsule = { summary: 'A compact capsule summary', facts: [], decisions: [], constraints: [], openQuestions: [], sourceTopicIds: [], sourceNodeIds: [] };
const topic = (id: string, parentTopicId: string | null = null, overrides: Partial<TreeMakerInputTopic> = {}): TreeMakerInputTopic => ({
  id, conversationId: 'workspace', parentTopicId, title: id, description: `${id} description`, contextEnabled: true, archivedAt: null, contextCapsule: capsule, createdAt: now, ...overrides,
});
const node = (id: string, topicId: string, overrides: Partial<TreeMakerInputNode> = {}): TreeMakerInputNode => ({
  id, conversationId: 'workspace', topicId, role: NodeRole.User, content: id, prunedAt: null, createdAt: now, updatedAt: now, ...overrides,
});
const build = (topics: TreeMakerInputTopic[], nodes: TreeMakerInputNode[] = [], options: Partial<Parameters<typeof buildTreeMakerInput>[1]> = {}) =>
  buildTreeMakerInput({ workspace: { id: 'workspace', title: 'Planning' }, topics, nodes, activeTopicId: 'root', activeNodeId: 'node-root', newPrompt: 'What should we do next?' }, options);

test('builds a compact, valid input for an empty workspace', () => {
  const input = build([], []);
  assert.deepEqual(input, {
    workspace: { id: 'workspace', title: 'Planning' }, activeTopicId: null, activeNodeId: null, topics: [], recentMessagesByTopic: {}, newPrompt: 'What should we do next?',
  });
});

test('keeps multiple roots and nested topic relationships separate from message ownership', () => {
  const input = build([topic('root'), topic('child', 'root'), topic('other')], [node('node-root', 'root'), node('node-child', 'child')]);
  assert.deepEqual(input.topics.map(({ id, parentTopicId, childTopicCount, messageCount }) => ({ id, parentTopicId, childTopicCount, messageCount })), [
    { id: 'other', parentTopicId: null, childTopicCount: 0, messageCount: 0 },
    { id: 'root', parentTopicId: null, childTopicCount: 1, messageCount: 1 },
    { id: 'child', parentTopicId: 'root', childTopicCount: 0, messageCount: 1 },
  ]);
  assert.deepEqual(input.recentMessagesByTopic.child, [{ id: 'node-child', role: 'user', contentPreview: 'node-child' }]);
});

test('omits archived topics and descendants from candidates and previews', () => {
  const input = build([topic('visible'), topic('archived', null, { archivedAt: now }), topic('hidden', 'archived')], [node('visible-node', 'visible'), node('archived-node', 'archived'), node('hidden-node', 'hidden')]);
  assert.deepEqual(input.topics.map(({ id }) => id), ['visible']);
  assert.deepEqual(input.recentMessagesByTopic, { visible: [{ id: 'visible-node', role: 'user', contentPreview: 'visible-node' }] });
  const configured = build([topic('archived', null, { archivedAt: now })], [], { excludeArchivedTopics: false });
  assert.deepEqual(configured.topics.map(({ id, archived }) => ({ id, archived })), [{ id: 'archived', archived: true }]);
});

test('excludes disabled topic lineages by default and can explicitly include them', () => {
  const topics = [topic('disabled', null, { contextEnabled: false }), topic('disabled-child', 'disabled'), topic('enabled')];
  assert.deepEqual(build(topics).topics.map(({ id }) => id), ['enabled']);
  const included = build(topics, [], { includeContextDisabledTopics: true });
  assert.deepEqual(included.topics.map(({ id, contextEnabled }) => ({ id, contextEnabled })), [
    { id: 'disabled', contextEnabled: false }, { id: 'disabled-child', contextEnabled: true }, { id: 'enabled', contextEnabled: true },
  ]);
});

test('truncates topic text and previews deterministically without retaining full messages', () => {
  const input = build([topic('root', null, { title: 'abcdefgh', description: 'abcdefgh', contextCapsule: { ...capsule, summary: 'abcdefgh' } })], [node('node-root', 'root', { content: 'abcdefgh' })], { previewLength: 5 });
  assert.equal(input.topics[0].title, 'abcd…');
  assert.equal(input.topics[0].description, 'abcd…');
  assert.equal(input.topics[0].capsuleSummary, 'abcd…');
  assert.deepEqual(input.recentMessagesByTopic.root, [{ id: 'node-root', role: 'user', contentPreview: 'abcd…' }]);
  assert.equal(JSON.stringify(input).includes('abcdefgh'), false);
});

test('applies deterministic topic and per-topic preview limits', () => {
  const earlier = new Date('2026-08-06T10:00:00.000Z');
  const later = new Date('2026-08-06T11:00:00.000Z');
  const input = build([topic('a', null, { createdAt: earlier }), topic('b', null, { createdAt: later })], [
    node('old', 'a', { createdAt: earlier, updatedAt: earlier }),
    node('new', 'a', { createdAt: later, updatedAt: later }),
  ], { maxTopics: 1, recentMessagesPerTopic: 1 });
  assert.deepEqual(input.topics.map(({ id }) => id), ['a']);
  assert.deepEqual(input.recentMessagesByTopic, { a: [{ id: 'new', role: 'user', contentPreview: 'new' }] });
  assert.throws(() => build([], [], { maxTopics: 0 }), /maxTopics must be a positive integer/);
});
