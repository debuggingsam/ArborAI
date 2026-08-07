import type { ComparisonResponse, ConversationNode, Topic, ConversationTreeResponse as SharedConversationTreeResponse } from '@arborai/shared';

export type { ConversationNode, Topic } from '@arborai/shared';
export type WorkspaceResponse = SharedConversationTreeResponse;

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  active: boolean;
  kind: 'topic' | 'ownership' | 'message';
};

export type ForestNode = {
  id: string;
  type: 'topicNode' | 'messageNode';
  position: { x: number; y: number };
  data: {
    topic?: Topic;
    node?: ConversationNode;
    active: boolean;
    ancestor: boolean;
    inheritedDisabled: boolean;
    alternative: boolean;
    comparison: 'shared' | 'left' | 'right' | null;
  };
};

const columnGap = 300;
const rowGap = 170;

export function truncateContent(content: string, maxLength = 120) {
  const line = content.replace(/\s+/g, ' ').trim();
  return line.length <= maxLength ? line : `${line.slice(0, maxLength - 1)}…`;
}

export function ancestorIds(nodes: ConversationNode[], selectedId: string | null) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result = new Set<string>();
  let current = selectedId ? byId.get(selectedId) : undefined;
  while (current && !result.has(current.id)) {
    result.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return result;
}

const ordered = <T extends { id: string; createdAt: string }>(items: T[]) => [...items].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));

/** Builds a stable topic forest without conflating topic ownership with message ancestry. */
export function toTopicForest(response: WorkspaceResponse, selectedTopicId: string | null, selectedNodeId: string | null, comparison?: ComparisonResponse | null) {
  const topicsById = new Map(response.topics.map((topic) => [topic.id, topic]));
  const nodesById = new Map(response.nodes.map((node) => [node.id, node]));
  const topicPath = new Set<string>();
  let selectedTopic = selectedTopicId ? topicsById.get(selectedTopicId) : undefined;
  while (selectedTopic && !topicPath.has(selectedTopic.id)) {
    topicPath.add(selectedTopic.id);
    selectedTopic = selectedTopic.parentTopicId ? topicsById.get(selectedTopic.parentTopicId) : undefined;
  }
  const messagePath = ancestorIds(response.nodes, selectedNodeId);
  const positions = new Map<string, { x: number; y: number }>();
  let row = 0;
  const positionMessageTree = (parentId: string | null, topicId: string, depth: number) => {
    for (const node of ordered(response.nodes.filter((item) => item.topicId === topicId && item.parentId === parentId))) {
      positions.set(`message:${node.id}`, { x: depth * columnGap, y: row++ * rowGap });
      positionMessageTree(node.id, topicId, depth + 1);
    }
  };
  const positionTopicTree = (parentId: string | null, depth: number) => {
    for (const topic of ordered(response.topics.filter((item) => item.parentTopicId === parentId))) {
      positions.set(`topic:${topic.id}`, { x: depth * columnGap, y: row++ * rowGap });
      positionMessageTree(null, topic.id, depth + 1);
      positionTopicTree(topic.id, depth + 1);
    }
  };
  positionTopicTree(null, 0);

  const inheritedDisabled = (topic: Topic) => {
    let current: Topic | undefined = topic;
    while (current) {
      if (!current.contextEnabled) return current.id !== topic.id;
      current = current.parentTopicId ? topicsById.get(current.parentTopicId) : undefined;
    }
    return false;
  };
  const isAlternative = (node: ConversationNode) => node.role === 'assistant' && node.parentId !== null
    && response.nodes.filter((item) => item.parentId === node.parentId && item.role === 'assistant').length > 1;
  const comparisonState = (id: string, type: 'topic' | 'node'): ForestNode['data']['comparison'] => {
    if (!comparison) return null;
    const shared = type === 'topic' ? comparison.sharedTopicPathIds : comparison.sharedMessagePathIds;
    const left = type === 'topic' ? comparison.left.branchTopicIds : comparison.left.branchMessageIds;
    const right = type === 'topic' ? comparison.right.branchTopicIds : comparison.right.branchMessageIds;
    return shared.includes(id) ? 'shared' : left.includes(id) ? 'left' : right.includes(id) ? 'right' : null;
  };
  const topicNodes: ForestNode[] = ordered(response.topics).map((topic) => ({
    id: `topic:${topic.id}`,
    type: 'topicNode',
    position: positions.get(`topic:${topic.id}`) ?? { x: 0, y: row++ * rowGap },
    data: { topic, active: topic.id === selectedTopicId, ancestor: topicPath.has(topic.id), inheritedDisabled: inheritedDisabled(topic), alternative: false, comparison: comparisonState(topic.id, 'topic') },
  }));
  const messageNodes: ForestNode[] = ordered(response.nodes).map((node) => ({
    id: `message:${node.id}`,
    type: 'messageNode',
    position: positions.get(`message:${node.id}`) ?? { x: columnGap, y: row++ * rowGap },
    data: { node, active: node.id === selectedNodeId, ancestor: messagePath.has(node.id), inheritedDisabled: inheritedDisabled(topicsById.get(node.topicId)!), alternative: isAlternative(node), comparison: comparisonState(node.id, 'node') },
  }));
  const edges: FlowEdge[] = [];
  for (const topic of response.topics) {
    if (topic.parentTopicId && topicsById.has(topic.parentTopicId)) edges.push({ id: `topic:${topic.parentTopicId}:${topic.id}`, source: `topic:${topic.parentTopicId}`, target: `topic:${topic.id}`, active: topicPath.has(topic.id), kind: 'topic' });
  }
  for (const node of response.nodes) {
    if (node.parentId && nodesById.has(node.parentId)) edges.push({ id: `message:${node.parentId}:${node.id}`, source: `message:${node.parentId}`, target: `message:${node.id}`, active: messagePath.has(node.id) && messagePath.has(node.parentId), kind: 'message' });
    else edges.push({ id: `owner:${node.topicId}:${node.id}`, source: `topic:${node.topicId}`, target: `message:${node.id}`, active: node.topicId === selectedTopicId, kind: 'ownership' });
  }
  return { nodes: [...topicNodes, ...messageNodes], edges };
}
