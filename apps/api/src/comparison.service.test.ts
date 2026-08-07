import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeRole, type ConversationNode, type Topic } from '@arborai/shared';
import { ComparisonService } from './comparison.service.js';

const at = '2026-08-06T00:00:00.000Z';
const topic = (id: string, parentTopicId: string | null): Topic => ({ id, conversationId: 'workspace', parentTopicId, title: id, description: null, activeNodeId: null, contextEnabled: true, archivedAt: null, createdAt: at, updatedAt: at });
const node = (id: string, topicId: string, parentId: string | null, role: 'user' | 'assistant' = 'user'): ConversationNode => ({ id, conversationId: 'workspace', topicId, parentId, role, content: id, status: 'completed', tokenCount: null, contextEnabled: true, pinned: false, errorMessage: null, prunedAt: null, createdAt: at, updatedAt: at });
const compare = (topics: Topic[], nodes: ConversationNode[], left: { type: 'topic' | 'node'; id: string }, right: { type: 'topic' | 'node'; id: string }) => new ComparisonService().compare({ workspaceId: 'workspace', topics, nodes, left, right });

test('compares alternative assistant responses without repeating their shared user message', () => {
  const result = compare([topic('root', null)], [node('user', 'root', null), node('answer-a', 'root', 'user', NodeRole.Assistant), node('answer-b', 'root', 'user', NodeRole.Assistant)], { type: 'node', id: 'answer-a' }, { type: 'node', id: 'answer-b' });
  assert.equal(result.nearestCommonTopicId, 'root');
  assert.equal(result.nearestCommonMessageId, 'user');
  assert.deepEqual(result.sharedMessagePathIds, ['user']);
  assert.deepEqual(result.left.branchMessageIds, ['answer-a']);
  assert.deepEqual(result.right.branchMessageIds, ['answer-b']);
});

test('compares two message branches in one topic from their nearest message ancestor', () => {
  const result = compare([topic('root', null)], [node('user', 'root', null), node('a', 'root', 'user', NodeRole.Assistant), node('a-next', 'root', 'a'), node('b', 'root', 'user', NodeRole.Assistant)], { type: 'node', id: 'a-next' }, { type: 'node', id: 'b' });
  assert.deepEqual(result.sharedTopicPathIds, ['root']);
  assert.deepEqual(result.sharedMessagePathIds, ['user']);
  assert.deepEqual(result.left.branchMessageIds, ['a', 'a-next']);
});

test('compares sibling subtopics from their proper topic ancestor without shared message content', () => {
  const result = compare([topic('root', null), topic('left', 'root'), topic('right', 'root')], [node('left-message', 'left', null), node('right-message', 'right', null)], { type: 'node', id: 'left-message' }, { type: 'node', id: 'right-message' });
  assert.equal(result.nearestCommonTopicId, 'root');
  assert.equal(result.nearestCommonMessageId, null);
  assert.deepEqual(result.sharedTopicPathIds, ['root']);
  assert.deepEqual(result.left.branchTopicIds, ['left']);
  assert.deepEqual(result.right.branchTopicIds, ['right']);
  assert.deepEqual(result.sharedMessagePathIds, []);
});

test('does not fabricate shared content for independent root topics', () => {
  const result = compare([topic('left-root', null), topic('right-root', null)], [node('left-message', 'left-root', null), node('right-message', 'right-root', null)], { type: 'topic', id: 'left-root' }, { type: 'topic', id: 'right-root' });
  assert.equal(result.nearestCommonTopicId, null);
  assert.equal(result.nearestCommonMessageId, null);
  assert.deepEqual(result.sharedTopicPathIds, []);
  assert.deepEqual(result.left.branchTopicIds, ['left-root']);
  assert.deepEqual(result.right.branchTopicIds, ['right-root']);
});
