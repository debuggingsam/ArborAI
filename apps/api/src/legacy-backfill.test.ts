import test from 'node:test';
import assert from 'node:assert/strict';
import { findLegacyImportTopic, LEGACY_MESSAGE_TREE_IMPORT_KEY, validateLegacyMessageTree } from './legacy-backfill.js';

test('validates a legacy message tree without changing message ancestry', () => {
  const report = validateLegacyMessageTree(
    'workspace',
    [{ id: 'topic', conversationId: 'workspace', parentTopicId: null, activeNodeId: 'assistant', legacyImportKey: LEGACY_MESSAGE_TREE_IMPORT_KEY }],
    [
      { id: 'user', conversationId: 'workspace', topicId: 'topic', parentId: null },
      { id: 'assistant', conversationId: 'workspace', topicId: 'topic', parentId: 'user' },
    ],
    'assistant',
  );
  assert.deepEqual(report.issues, []);
  assert.equal(findLegacyImportTopic([{ id: 'topic', conversationId: 'workspace', parentTopicId: null, activeNodeId: null, legacyImportKey: LEGACY_MESSAGE_TREE_IMPORT_KEY }])?.id, 'topic');
});

test('reports orphaned, cross-conversation, missing active, and cyclic legacy data', () => {
  const report = validateLegacyMessageTree(
    'workspace',
    [{ id: 'topic', conversationId: 'workspace', parentTopicId: null, activeNodeId: 'missing', legacyImportKey: LEGACY_MESSAGE_TREE_IMPORT_KEY }],
    [
      { id: 'orphan', conversationId: 'workspace', topicId: 'topic', parentId: 'absent' },
      { id: 'cycle-a', conversationId: 'workspace', topicId: 'topic', parentId: 'cycle-b' },
      { id: 'cycle-b', conversationId: 'workspace', topicId: 'topic', parentId: 'cycle-a' },
      { id: 'cross', conversationId: 'workspace', topicId: 'topic', parentId: 'other' },
      { id: 'other', conversationId: 'other-workspace', topicId: 'topic', parentId: null },
    ],
    null,
  );
  assert.deepEqual(report.issues.map((issue) => issue.code).sort(), [
    'cross_conversation_parent_reference',
    'message_cycle',
    'message_cycle',
    'missing_active_node',
    'orphaned_message_node',
  ]);
});
