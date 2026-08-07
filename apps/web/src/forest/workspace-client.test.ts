import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkspaceEvent } from './workspace-client.js';
import type { WorkspaceResponse } from '../conversation-tree.js';

const at = '2026-01-01T00:00:00.000Z';
const tree: WorkspaceResponse = { conversation: { id: 'workspace', title: 'Workspace', systemPrompt: '', activeTopicId: 'topic', createdAt: at, updatedAt: at }, activeTopicId: 'topic', topics: [{ id: 'topic', conversationId: 'workspace', parentTopicId: null, title: 'Topic', description: null, activeNodeId: null, contextEnabled: true, archivedAt: null, createdAt: at, updatedAt: at }], nodes: [{ id: 'assistant', conversationId: 'workspace', topicId: 'topic', parentId: null, role: 'assistant', content: '', status: 'pending', tokenCount: null, contextEnabled: true, pinned: false, errorMessage: null, prunedAt: null, createdAt: at, updatedAt: at }] };
const envelope = (payload: any) => ({ eventId: 'event', eventType: payload.eventType, workspaceId: 'workspace', generationId: 'generation', occurredAt: at, payload });

test('applies assistant deltas and completion to only the targeted graph node', () => {
  const streaming = applyWorkspaceEvent(tree, envelope({ eventType: 'assistant.delta', assistantNodeId: 'assistant', delta: 'Hello' }));
  assert.deepEqual(streaming.nodes[0].content, 'Hello');
  assert.equal(streaming.nodes[0].status, 'streaming');
  const completed = applyWorkspaceEvent(streaming, envelope({ eventType: 'assistant.completed', assistantNodeId: 'assistant', content: 'Hello world' }));
  assert.deepEqual(completed.nodes[0].content, 'Hello world');
  assert.equal(completed.nodes[0].status, 'completed');
});

test('removes every pruned descendant from local graph state', () => {
  const expanded = { ...tree, nodes: [...tree.nodes, { ...tree.nodes[0]!, id: 'child', parentId: 'assistant' }] };
  const pruned = applyWorkspaceEvent(expanded, envelope({ eventType: 'node.pruned', nodeId: 'assistant', prunedNodeIds: ['assistant', 'child'], activeNodeId: null }));
  assert.deepEqual(pruned.nodes, []);
});
