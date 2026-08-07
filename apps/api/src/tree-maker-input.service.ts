import { NodeRole, type TreeMakerInput, TreeMakerInputSchema, type TopicContextCapsule } from '@arborai/shared';

type Timestamp = Date | string;

export type TreeMakerInputBuilderConfig = {
  maxTopics: number;
  recentMessagesPerTopic: number;
  previewLength: number;
  excludeArchivedTopics: boolean;
  includeContextDisabledTopics: boolean;
};

export const defaultTreeMakerInputBuilderConfig: TreeMakerInputBuilderConfig = {
  maxTopics: 50,
  recentMessagesPerTopic: 3,
  previewLength: 500,
  excludeArchivedTopics: true,
  includeContextDisabledTopics: false,
};

export type TreeMakerInputWorkspace = { id: string; title: string };
export type TreeMakerInputTopic = {
  id: string;
  conversationId: string;
  parentTopicId: string | null;
  title: string;
  description: string | null;
  contextEnabled: boolean;
  archivedAt: Timestamp | null;
  contextCapsule: TopicContextCapsule | null;
  createdAt: Timestamp;
};
export type TreeMakerInputNode = {
  id: string;
  conversationId: string;
  topicId: string;
  role: NodeRole;
  content: string;
  prunedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type BuildTreeMakerInputRequest = {
  workspace: TreeMakerInputWorkspace;
  topics: TreeMakerInputTopic[];
  nodes: TreeMakerInputNode[];
  activeTopicId: string | null;
  activeNodeId: string | null;
  newPrompt: string;
};

/** Builds the bounded routing index; it intentionally has no persistence or provider dependency. */
export function buildTreeMakerInput(
  request: BuildTreeMakerInputRequest,
  config: Partial<TreeMakerInputBuilderConfig> = {},
): TreeMakerInput {
  const settings = validateConfig({ ...defaultTreeMakerInputBuilderConfig, ...config });
  const workspaceTopics = request.topics.filter((topic) => topic.conversationId === request.workspace.id);
  const byId = new Map(workspaceTopics.map((topic) => [topic.id, topic]));
  const availableTopics = workspaceTopics.filter((topic) => isAvailable(topic, byId, settings));
  const availableIds = new Set(availableTopics.map((topic) => topic.id));
  const orderedTopics = orderTopics(availableTopics, availableIds).slice(0, settings.maxTopics);
  const selectedIds = new Set(orderedTopics.map((topic) => topic.id));
  const visibleNodes = request.nodes.filter((node) => node.conversationId === request.workspace.id && node.prunedAt === null && selectedIds.has(node.topicId));
  const nodesByTopic = groupByTopic(visibleNodes);
  const activeTopicId = request.activeTopicId && selectedIds.has(request.activeTopicId) ? request.activeTopicId : null;
  const activeNodeId = activeTopicId && request.activeNodeId && (nodesByTopic.get(activeTopicId) ?? []).some((node) => node.id === request.activeNodeId)
    ? request.activeNodeId
    : null;

  const input: TreeMakerInput = {
    workspace: { id: request.workspace.id, title: truncate(request.workspace.title, settings.previewLength) },
    activeTopicId,
    activeNodeId,
    topics: orderedTopics.map((topic) => {
      const topicNodes = nodesByTopic.get(topic.id) ?? [];
      const recentNode = mostRecent(topicNodes);
      return {
        id: topic.id,
        parentTopicId: topic.parentTopicId && selectedIds.has(topic.parentTopicId) ? topic.parentTopicId : null,
        title: truncate(topic.title, settings.previewLength),
        description: topic.description === null ? null : truncate(topic.description, settings.previewLength),
        capsuleSummary: topic.contextCapsule === null ? null : truncate(topic.contextCapsule.summary, settings.previewLength),
        recentActivity: recentNode ? toIso(recentNode.updatedAt) : null,
        contextEnabled: topic.contextEnabled,
        archived: topic.archivedAt !== null,
        childTopicCount: availableTopics.filter((child) => child.parentTopicId === topic.id).length,
        messageCount: topicNodes.length,
      };
    }),
    recentMessagesByTopic: Object.fromEntries(orderedTopics.map((topic) => [topic.id, recentPreviews(nodesByTopic.get(topic.id) ?? [], settings)])),
    newPrompt: request.newPrompt,
  };
  return TreeMakerInputSchema.parse(input);
}

function isAvailable(topic: TreeMakerInputTopic, byId: Map<string, TreeMakerInputTopic>, settings: TreeMakerInputBuilderConfig) {
  const seen = new Set<string>();
  let current: TreeMakerInputTopic | undefined = topic;
  while (current) {
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    if (settings.excludeArchivedTopics && current.archivedAt !== null) return false;
    if (!settings.includeContextDisabledTopics && !current.contextEnabled) return false;
    current = current.parentTopicId ? byId.get(current.parentTopicId) : undefined;
  }
  return true;
}

function orderTopics(topics: TreeMakerInputTopic[], topicIds: Set<string>) {
  const children = new Map<string | null, TreeMakerInputTopic[]>();
  for (const topic of topics) {
    const parentId = topic.parentTopicId && topicIds.has(topic.parentTopicId) ? topic.parentTopicId : null;
    children.set(parentId, [...(children.get(parentId) ?? []), topic]);
  }
  const sort = (items: TreeMakerInputTopic[]) => items.sort((left, right) => toMillis(left.createdAt) - toMillis(right.createdAt) || left.id.localeCompare(right.id));
  const ordered: TreeMakerInputTopic[] = [];
  const visit = (parentId: string | null) => {
    for (const topic of sort(children.get(parentId) ?? [])) {
      ordered.push(topic);
      visit(topic.id);
    }
  };
  visit(null);
  return ordered;
}

function groupByTopic(nodes: TreeMakerInputNode[]) {
  const result = new Map<string, TreeMakerInputNode[]>();
  for (const node of nodes) result.set(node.topicId, [...(result.get(node.topicId) ?? []), node]);
  return result;
}

function recentPreviews(nodes: TreeMakerInputNode[], settings: TreeMakerInputBuilderConfig) {
  return [...nodes]
    .filter((node): node is TreeMakerInputNode & { role: 'user' | 'assistant' } => node.role === NodeRole.User || node.role === NodeRole.Assistant)
    .sort((left, right) => toMillis(right.updatedAt) - toMillis(left.updatedAt) || right.id.localeCompare(left.id))
    .slice(0, settings.recentMessagesPerTopic)
    .sort((left, right) => toMillis(left.createdAt) - toMillis(right.createdAt) || left.id.localeCompare(right.id))
    .map((node) => ({ id: node.id, role: node.role, contentPreview: truncate(node.content, settings.previewLength) }));
}

function mostRecent(nodes: TreeMakerInputNode[]) {
  return [...nodes].sort((left, right) => toMillis(right.updatedAt) - toMillis(left.updatedAt) || right.id.localeCompare(left.id))[0];
}

function truncate(value: string, length: number) {
  return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 1))}…`;
}

function toMillis(value: Timestamp) { return typeof value === 'string' ? Date.parse(value) : value.getTime(); }
function toIso(value: Timestamp) { return typeof value === 'string' ? new Date(value).toISOString() : value.toISOString(); }

function validateConfig(config: TreeMakerInputBuilderConfig) {
  for (const [name, value] of [
    ['maxTopics', config.maxTopics],
    ['recentMessagesPerTopic', config.recentMessagesPerTopic],
    ['previewLength', config.previewLength],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  }
  return config;
}
