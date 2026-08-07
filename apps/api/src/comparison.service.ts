import type { ComparisonResponse, ComparisonSelection } from '@arborai/shared';

export class ComparisonValidationError extends Error {}
export class ComparisonWorkspaceNotFoundError extends Error {}

type ComparisonTopic = { id: string; conversationId: string; parentTopicId: string | null };
type ComparisonNode = { id: string; conversationId: string; topicId: string; parentId: string | null };
type ComparisonInput = { workspaceId: string; topics: ComparisonTopic[]; nodes: ComparisonNode[]; left: ComparisonSelection; right: ComparisonSelection };

/** Pure graph comparison: topic ancestry and message ancestry remain separate. */
export class ComparisonService {
  compare(input: ComparisonInput): ComparisonResponse {
    const topics = new Map(input.topics.filter((topic) => topic.conversationId === input.workspaceId).map((topic) => [topic.id, topic]));
    const nodes = new Map(input.nodes.filter((node) => node.conversationId === input.workspaceId).map((node) => [node.id, node]));
    const left = this.side(input.left, input.workspaceId, topics, nodes);
    const right = this.side(input.right, input.workspaceId, topics, nodes);
    const sharedTopicPathIds = sharedPrefix(left.topicPathIds, right.topicPathIds);
    const sharedMessagePathIds = left.selection.type === 'node' && right.selection.type === 'node'
      ? sharedPrefix(left.messagePathIds, right.messagePathIds)
      : [];
    return {
      workspaceId: input.workspaceId,
      nearestCommonTopicId: sharedTopicPathIds.at(-1) ?? null,
      nearestCommonMessageId: sharedMessagePathIds.at(-1) ?? null,
      sharedTopicPathIds,
      sharedMessagePathIds,
      left: { ...left, branchTopicIds: left.topicPathIds.slice(sharedTopicPathIds.length), branchMessageIds: left.messagePathIds.slice(sharedMessagePathIds.length) },
      right: { ...right, branchTopicIds: right.topicPathIds.slice(sharedTopicPathIds.length), branchMessageIds: right.messagePathIds.slice(sharedMessagePathIds.length) },
    };
  }

  private side(selection: ComparisonSelection, workspaceId: string, topics: Map<string, ComparisonTopic>, nodes: Map<string, ComparisonNode>) {
    const selectedNode = selection.type === 'node' ? nodes.get(selection.id) : undefined;
    const topicId = selection.type === 'topic' ? selection.id : selectedNode?.topicId;
    if (!topicId || !topics.has(topicId)) throw new ComparisonValidationError('Each comparison selection must belong to the workspace.');
    const topicPathIds = topicPath(topicId, workspaceId, topics);
    const messagePathIds = selectedNode ? messagePath(selectedNode.id, workspaceId, selectedNode.topicId, nodes) : [];
    return { selection, topicPathIds, messagePathIds, branchTopicIds: [], branchMessageIds: [] };
  }
}

export interface ComparisonStore {
  load(workspaceId: string): Promise<{ exists: boolean; topics: ComparisonTopic[]; nodes: ComparisonNode[] }>;
}

export class ComparisonApplicationService {
  constructor(private readonly store: ComparisonStore, private readonly comparison = new ComparisonService()) {}
  async compare(workspaceId: string, selections: { left: ComparisonSelection; right: ComparisonSelection }) {
    const graph = await this.store.load(workspaceId);
    if (!graph.exists) throw new ComparisonWorkspaceNotFoundError();
    return this.comparison.compare({ workspaceId, topics: graph.topics, nodes: graph.nodes, ...selections });
  }
}

function topicPath(topicId: string, workspaceId: string, topics: Map<string, ComparisonTopic>) {
  const path: string[] = [];
  const seen = new Set<string>();
  let current = topics.get(topicId);
  while (current && !seen.has(current.id)) {
    if (current.conversationId !== workspaceId) break;
    path.push(current.id); seen.add(current.id);
    const parent = current.parentTopicId ? topics.get(current.parentTopicId) : undefined;
    if (parent && parent.conversationId !== workspaceId) break;
    current = parent;
  }
  return path.reverse();
}

function messagePath(nodeId: string, workspaceId: string, topicId: string, nodes: Map<string, ComparisonNode>) {
  const path: string[] = [];
  const seen = new Set<string>();
  let current = nodes.get(nodeId);
  while (current && !seen.has(current.id)) {
    if (current.conversationId !== workspaceId || current.topicId !== topicId) break;
    path.push(current.id); seen.add(current.id);
    const parent = current.parentId ? nodes.get(current.parentId) : undefined;
    if (parent && (parent.conversationId !== workspaceId || parent.topicId !== topicId)) break;
    current = parent;
  }
  return path.reverse();
}

function sharedPrefix(left: string[], right: string[]) {
  const shared: string[] = [];
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) break;
    shared.push(left[index]!);
  }
  return shared;
}
