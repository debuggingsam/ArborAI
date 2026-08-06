export const LEGACY_MESSAGE_TREE_IMPORT_KEY = 'legacy-message-tree-v1';

export type BackfillNode = {
  id: string;
  conversationId: string;
  topicId: string;
  parentId: string | null;
};

export type BackfillTopic = {
  id: string;
  conversationId: string;
  parentTopicId: string | null;
  activeNodeId: string | null;
  legacyImportKey: string | null;
};

export type BackfillIssueCode =
  | 'orphaned_message_node'
  | 'cross_conversation_parent_reference'
  | 'cross_topic_parent_reference'
  | 'missing_active_node'
  | 'message_cycle';

export type BackfillIssue = {
  code: BackfillIssueCode;
  nodeId?: string;
  topicId?: string;
  parentId?: string;
  message: string;
};

export type BackfillValidationReport = {
  conversationId: string;
  issues: BackfillIssue[];
};

export function validateLegacyMessageTree(
  conversationId: string,
  topics: BackfillTopic[],
  nodes: BackfillNode[],
  legacyActiveNodeId: string | null,
): BackfillValidationReport {
  const issues: BackfillIssue[] = [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const conversationNodes = nodes.filter((node) => node.conversationId === conversationId);

  for (const node of conversationNodes) {
    if (!node.parentId) continue;
    const parent = nodesById.get(node.parentId);
    if (!parent) {
      issues.push({ code: 'orphaned_message_node', nodeId: node.id, parentId: node.parentId, message: 'Message parent does not exist.' });
    } else if (parent.conversationId !== node.conversationId) {
      issues.push({ code: 'cross_conversation_parent_reference', nodeId: node.id, parentId: node.parentId, message: 'Message parent belongs to another conversation.' });
    } else if (parent.topicId !== node.topicId) {
      issues.push({ code: 'cross_topic_parent_reference', nodeId: node.id, parentId: node.parentId, message: 'Message parent belongs to another topic.' });
    }
  }

  const activeNodeIds = [
    ...topics.filter((topic) => topic.conversationId === conversationId).map((topic) => ({ topicId: topic.id, nodeId: topic.activeNodeId })),
    { topicId: undefined, nodeId: legacyActiveNodeId },
  ];
  for (const active of activeNodeIds) {
    if (!active.nodeId) continue;
    const node = nodesById.get(active.nodeId);
    if (!node || node.conversationId !== conversationId || (active.topicId && node.topicId !== active.topicId)) {
      issues.push({ code: 'missing_active_node', topicId: active.topicId, nodeId: active.nodeId, message: 'Active node is missing, belongs to another conversation, or belongs to another topic.' });
    }
  }

  for (const node of conversationNodes) {
    const path = new Set<string>();
    let current: BackfillNode | undefined = node;
    while (current) {
      if (path.has(current.id)) {
        issues.push({ code: 'message_cycle', nodeId: node.id, message: 'Message parent references contain a cycle.' });
        break;
      }
      path.add(current.id);
      current = current.parentId ? nodesById.get(current.parentId) : undefined;
    }
  }

  return { conversationId, issues };
}

export function findLegacyImportTopic(topics: BackfillTopic[]) {
  return topics.find((topic) => topic.legacyImportKey === LEGACY_MESSAGE_TREE_IMPORT_KEY) ?? null;
}
