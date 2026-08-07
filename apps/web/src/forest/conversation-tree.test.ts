import test from 'node:test';
import assert from 'node:assert/strict';
import { toTopicForest, type WorkspaceResponse } from '../conversation-tree.js';

const at = '2026-01-01T00:00:00.000Z';
const topic = (id: string, parentTopicId: string | null, contextEnabled = true) => ({ id, conversationId: 'workspace', parentTopicId, title: id, description: null, activeNodeId: null, contextEnabled, archivedAt: null, createdAt: at, updatedAt: at });
const node = (id: string, topicId: string, parentId: string | null, role: 'user' | 'assistant' = 'user') => ({ id, conversationId: 'workspace', topicId, parentId, role, content: id, status: 'completed' as const, tokenCount: null, contextEnabled: true, pinned: false, errorMessage: null, prunedAt: null, createdAt: at, updatedAt: at });

test('lays out independent roots, nested topics, and sibling assistant alternatives distinctly', () => {
  const response: WorkspaceResponse = { conversation: { id: 'workspace', title: 'Workspace', systemPrompt: '', activeTopicId: 'child', createdAt: at, updatedAt: at }, activeTopicId: 'child', topics: [topic('root-a', null), topic('child', 'root-a'), topic('root-b', null), topic('disabled', 'root-a', false)], nodes: [node('user', 'child', null), node('answer-a', 'child', 'user', 'assistant'), node('answer-b', 'child', 'user', 'assistant'), node('other', 'root-b', null)] };
  const graph = toTopicForest(response, 'child', 'answer-b');
  assert.equal(graph.nodes.filter((item) => item.type === 'topicNode').length, 4);
  assert.equal(graph.edges.filter((item) => item.kind === 'topic').length, 2);
  assert.equal(graph.edges.filter((item) => item.kind === 'ownership').length, 2);
  assert.equal(graph.edges.filter((item) => item.kind === 'message').length, 2);
  assert.equal(graph.nodes.find((item) => item.id === 'message:answer-a')?.data.alternative, true);
  assert.equal(graph.nodes.find((item) => item.id === 'topic:disabled')?.data.inheritedDisabled, false);
  assert.notDeepEqual(graph.nodes.find((item) => item.id === 'topic:root-a')?.position, graph.nodes.find((item) => item.id === 'topic:root-b')?.position);
});

test('marks shared and branch-specific comparison paths separately', () => {
  const response: WorkspaceResponse = { conversation: { id: 'workspace', title: 'Workspace', systemPrompt: '', activeTopicId: 'root', createdAt: at, updatedAt: at }, activeTopicId: 'root', topics: [topic('root', null)], nodes: [node('user', 'root', null), node('left', 'root', 'user', 'assistant'), node('right', 'root', 'user', 'assistant')] };
  const graph = toTopicForest(response, 'root', null, { workspaceId: 'workspace', nearestCommonTopicId: 'root', nearestCommonMessageId: 'user', sharedTopicPathIds: ['root'], sharedMessagePathIds: ['user'], left: { selection: { type: 'node', id: 'left' }, topicPathIds: ['root'], messagePathIds: ['user', 'left'], branchTopicIds: [], branchMessageIds: ['left'] }, right: { selection: { type: 'node', id: 'right' }, topicPathIds: ['root'], messagePathIds: ['user', 'right'], branchTopicIds: [], branchMessageIds: ['right'] } });
  assert.equal(graph.nodes.find((item) => item.id === 'topic:root')?.data.comparison, 'shared');
  assert.equal(graph.nodes.find((item) => item.id === 'message:user')?.data.comparison, 'shared');
  assert.equal(graph.nodes.find((item) => item.id === 'message:left')?.data.comparison, 'left');
  assert.equal(graph.nodes.find((item) => item.id === 'message:right')?.data.comparison, 'right');
});
