import {
  ContextExclusionReason,
  ContextMessageSourceType,
  ContextPreviewResponseSchema,
  ContextWarningCode,
  NodeRole,
  type ContextExclusion,
  type ContextPreviewResponse,
  type ContextWarning,
  type ModelMessage,
  type TopicContextCapsule,
} from '@arborai/shared';

type Timestamp = Date | string;

export type ContextEngineWorkspace = { id: string; systemPrompt: string | null };
export type ContextEngineTopic = {
  id: string; conversationId: string; parentTopicId: string | null; title: string;
  contextEnabled: boolean; archivedAt: Timestamp | null; contextCapsule: TopicContextCapsule | null;
};
export type ContextEngineNode = {
  id: string; conversationId: string; topicId: string; parentId: string | null;
  role: NodeRole; content: string; contextEnabled: boolean; pinned: boolean;
  prunedAt: Timestamp | null; createdAt: Timestamp;
};
export type AssembleContextRequest = {
  workspace: ContextEngineWorkspace; topics: ContextEngineTopic[]; nodes: ContextEngineNode[];
  topicId: string; anchorNodeId: string | null; newPrompt: string; maxInputTokens?: number | null;
};
export type ContextTokenEstimator = (messages: ModelMessage[]) => number;

export class ContextEngineValidationError extends Error {}

/**
 * Pure, deterministic context selection. It deliberately has no persistence,
 * TreeMaker, transport, or provider-SDK dependency.
 */
export class ContextEngine {
  constructor(private readonly tokenEstimator: ContextTokenEstimator = estimateTokens) {}

  assemble(request: AssembleContextRequest): ContextPreviewResponse {
    if (request.maxInputTokens !== undefined && request.maxInputTokens !== null
      && (!Number.isInteger(request.maxInputTokens) || request.maxInputTokens < 1)) {
      throw new ContextEngineValidationError('maxInputTokens must be a positive integer.');
    }
    const topics = request.topics.filter((topic) => topic.conversationId === request.workspace.id);
    const nodes = request.nodes.filter((node) => node.conversationId === request.workspace.id);
    const topicsById = uniqueById(topics, 'topic');
    const nodesById = uniqueById(nodes, 'node');
    const activeTopic = topicsById.get(request.topicId);
    if (!activeTopic) throw new ContextEngineValidationError('Active topic does not belong to the workspace.');

    const lineage = topicLineage(activeTopic, topicsById, request.workspace.id);
    const lineageIds = new Set(lineage.map((topic) => topic.id));
    const exclusions: ContextExclusion[] = [];
    const warnings: ContextWarning[] = [];
    const excludedTopicIds: string[] = [];
    const excludedNodeIds: string[] = [];
    const addExclusion = (targetType: 'topic' | 'node', targetId: string, reason: ContextExclusion['reason']) => {
      if (exclusions.some((item) => item.targetType === targetType && item.targetId === targetId)) return;
      exclusions.push({ targetType, targetId, reason });
      (targetType === 'topic' ? excludedTopicIds : excludedNodeIds).push(targetId);
    };
    const addWarning = (warning: ContextWarning) => {
      if (!warnings.some((item) => item.code === warning.code && item.topicId === warning.topicId && item.nodeId === warning.nodeId)) warnings.push(warning);
    };

    const effectiveTopicState = new Map<string, 'enabled' | ContextExclusion['reason']>();
    for (const topic of stableTopics(topics)) {
      const state = stateForTopic(topic, topicsById, request.workspace.id);
      effectiveTopicState.set(topic.id, state);
      if (state !== 'enabled') addExclusion('topic', topic.id, state);
    }
    if (effectiveTopicState.get(activeTopic.id) !== 'enabled') {
      throw new ContextEngineValidationError('Active topic is archived or context-disabled.');
    }
    const activeRootId = lineage[0]!.id;
    for (const topic of stableTopics(topics)) {
      if (lineageIds.has(topic.id) || effectiveTopicState.get(topic.id) !== 'enabled') continue;
      const rootId = rootTopicId(topic, topicsById, request.workspace.id);
      addExclusion('topic', topic.id, rootId === activeRootId
        ? ContextExclusionReason.SiblingTopic
        : ContextExclusionReason.UnrelatedRootTopic);
    }

    const entries: ContextEntry[] = [];
    if (request.workspace.systemPrompt?.trim()) entries.push({ kind: 'required', message: { role: 'system', content: request.workspace.systemPrompt, sourceType: ContextMessageSourceType.WorkspaceSystemPrompt, sourceId: null } });
    for (const topic of lineage) {
      if (!topic.contextCapsule) {
        addWarning({ code: ContextWarningCode.CapsuleMissing, message: 'An enabled topic has no context capsule.', topicId: topic.id });
        continue;
      }
      entries.push({ kind: 'required', message: { role: 'system', content: capsuleMessage(topic), sourceType: ContextMessageSourceType.TopicCapsule, sourceId: topic.id } });
    }

    const path = selectedPath(request.anchorNodeId, activeTopic.id, nodesById, request.workspace.id, addWarning);
    const pathIds = new Set(path.map((node) => node.id));
    const pinned = stableNodes(nodes).filter((node) => node.pinned && lineageIds.has(node.topicId) && !pathIds.has(node.id));
    for (const node of pinned) addNodeIfEligible(node, entries, addExclusion, addWarning);
    for (const node of path) addNodeIfEligible(node, entries, addExclusion, addWarning);

    // Record alternatives in the active topic, including disabled/pruned alternatives
    // with their more specific lifecycle reason taking precedence.
    for (const node of stableNodes(nodes)) {
      if (node.topicId !== activeTopic.id || pathIds.has(node.id) || node.pinned) continue;
      if (!node.contextEnabled) addExclusion('node', node.id, ContextExclusionReason.MessageContextDisabled);
      else if (node.prunedAt !== null) addExclusion('node', node.id, ContextExclusionReason.MessagePruned);
      else addExclusion('node', node.id, ContextExclusionReason.AlternativeBranchNotSelected);
    }
    entries.push({ kind: 'required', message: { role: 'user', content: request.newPrompt, sourceType: ContextMessageSourceType.NewPrompt, sourceId: null } });

    const trimmedNodeIds: string[] = [];
    const maxInputTokens = request.maxInputTokens ?? null;
    let messages = entries.map((entry) => entry.message);
    if (maxInputTokens !== null && this.tokenEstimator(messages) > maxInputTokens) {
      const removable = entries.filter((entry): entry is Extract<ContextEntry, { kind: 'node' }> => entry.kind === 'node')
        .sort((left, right) => toMillis(left.createdAt) - toMillis(right.createdAt) || left.nodeId.localeCompare(right.nodeId));
      for (const entry of removable) {
        if (this.tokenEstimator(messages) <= maxInputTokens) break;
        const index = entries.indexOf(entry);
        if (index < 0) continue;
        entries.splice(index, 1);
        trimmedNodeIds.push(entry.nodeId);
        addExclusion('node', entry.nodeId, ContextExclusionReason.TokenBudget);
        messages = entries.map((item) => item.message);
      }
      if (this.tokenEstimator(messages) > maxInputTokens) addWarning({ code: ContextWarningCode.TokenBudgetTooSmall, message: 'The token budget cannot fit required context.', topicId: activeTopic.id });
    }
    const includedTopicIds = lineage.filter((topic) => topic.contextCapsule !== null).map((topic) => topic.id);
    const includedNodeIds = entries.filter((entry) => entry.kind === 'node').map((entry) => entry.nodeId!);
    return ContextPreviewResponseSchema.parse({
      messages, includedTopicIds, includedNodeIds, excludedTopicIds, excludedNodeIds,
      exclusions, warnings, trimmedNodeIds, estimatedInputTokens: this.tokenEstimator(messages), maxInputTokens,
    });
  }
}

type ContextEntry = { kind: 'required'; message: ModelMessage } | { kind: 'node'; nodeId: string; createdAt: Timestamp; message: ModelMessage };

function addNodeIfEligible(node: ContextEngineNode, entries: ContextEntry[], addExclusion: (type: 'topic' | 'node', id: string, reason: ContextExclusion['reason']) => void, addWarning: (warning: ContextWarning) => void) {
  if (!node.contextEnabled) { addExclusion('node', node.id, ContextExclusionReason.MessageContextDisabled); addWarning({ code: ContextWarningCode.ContextGap, message: 'A selected message is context-disabled.', nodeId: node.id }); return; }
  if (node.prunedAt !== null) { addExclusion('node', node.id, ContextExclusionReason.MessagePruned); addWarning({ code: ContextWarningCode.ContextGap, message: 'A selected message is pruned.', nodeId: node.id }); return; }
  if (node.role !== NodeRole.User && node.role !== NodeRole.Assistant) return;
  entries.push({ kind: 'node', nodeId: node.id, createdAt: node.createdAt, message: { role: node.role, content: node.content, sourceType: ContextMessageSourceType.MessageNode, sourceId: node.id } });
}

function selectedPath(anchorNodeId: string | null, topicId: string, nodesById: Map<string, ContextEngineNode>, workspaceId: string, addWarning: (warning: ContextWarning) => void) {
  if (!anchorNodeId) return [];
  const anchor = nodesById.get(anchorNodeId);
  if (!anchor || anchor.topicId !== topicId) { addWarning({ code: ContextWarningCode.MissingActiveNode, message: 'The selected active node is unavailable.', nodeId: anchorNodeId }); return []; }
  const result: ContextEngineNode[] = [];
  const seen = new Set<string>();
  let current: ContextEngineNode | undefined = anchor;
  while (current) {
    if (seen.has(current.id)) throw new ContextEngineValidationError('Message lineage contains a cycle.');
    seen.add(current.id);
    if (current.conversationId !== workspaceId || current.topicId !== topicId) { addWarning({ code: ContextWarningCode.InvalidParentReference, message: 'A message parent is outside the active topic or workspace.', nodeId: current.id }); break; }
    result.push(current);
    if (!current.parentId) break;
    const parent = nodesById.get(current.parentId);
    if (!parent || parent.conversationId !== workspaceId || parent.topicId !== topicId) { addWarning({ code: ContextWarningCode.InvalidParentReference, message: 'A message parent is outside the active topic or workspace.', nodeId: current.id }); break; }
    current = parent;
  }
  return result.reverse();
}

function topicLineage(topic: ContextEngineTopic, byId: Map<string, ContextEngineTopic>, workspaceId: string) {
  const result: ContextEngineTopic[] = [];
  const seen = new Set<string>();
  let current: ContextEngineTopic | undefined = topic;
  while (current) {
    if (seen.has(current.id)) throw new ContextEngineValidationError('Topic lineage contains a cycle.');
    if (current.conversationId !== workspaceId) throw new ContextEngineValidationError('Topic lineage crosses workspaces.');
    seen.add(current.id); result.push(current);
    if (!current.parentTopicId) break;
    current = byId.get(current.parentTopicId);
    if (!current) throw new ContextEngineValidationError('Topic lineage has an invalid parent reference.');
  }
  return result.reverse();
}

function stateForTopic(topic: ContextEngineTopic, byId: Map<string, ContextEngineTopic>, workspaceId: string): 'enabled' | ContextExclusion['reason'] {
  const seen = new Set<string>(); let current: ContextEngineTopic | undefined = topic; let descendant = false;
  while (current) {
    if (seen.has(current.id)) throw new ContextEngineValidationError('Topic hierarchy contains a cycle.');
    if (current.conversationId !== workspaceId) throw new ContextEngineValidationError('Topic hierarchy crosses workspaces.');
    seen.add(current.id);
    if (current.archivedAt !== null) return ContextExclusionReason.TopicArchived;
    if (!current.contextEnabled) return descendant ? ContextExclusionReason.AncestorTopicContextDisabled : ContextExclusionReason.TopicContextDisabled;
    descendant = true;
    const parentId: string | null = current.parentTopicId;
    current = parentId ? byId.get(parentId) : undefined;
    if (parentId && !current) throw new ContextEngineValidationError('Topic hierarchy has an invalid parent reference.');
  }
  return 'enabled';
}

function rootTopicId(topic: ContextEngineTopic, byId: Map<string, ContextEngineTopic>, workspaceId: string) { return topicLineage(topic, byId, workspaceId)[0]!.id; }
function stableTopics(topics: ContextEngineTopic[]) { return [...topics].sort((left, right) => left.id.localeCompare(right.id)); }
function stableNodes(nodes: ContextEngineNode[]) { return [...nodes].sort((left, right) => toMillis(left.createdAt) - toMillis(right.createdAt) || left.id.localeCompare(right.id)); }
function uniqueById<T extends { id: string }>(items: T[], label: string) { const result = new Map<string, T>(); for (const item of items) { if (result.has(item.id)) throw new ContextEngineValidationError(`Duplicate ${label} ID.`); result.set(item.id, item); } return result; }
function capsuleMessage(topic: ContextEngineTopic) { const capsule = topic.contextCapsule!; const sections = [['Facts', capsule.facts], ['Decisions', capsule.decisions], ['Constraints', capsule.constraints], ['Open questions', capsule.openQuestions]].filter(([, values]) => values.length > 0).map(([heading, values]) => `${heading}: ${(values as string[]).join('; ')}`); return [`Topic context: ${topic.title}`, capsule.summary, ...sections].join('\n'); }
function toMillis(value: Timestamp) { return typeof value === 'string' ? Date.parse(value) : value.getTime(); }
export function estimateTokens(messages: ModelMessage[]) { return Math.ceil(messages.reduce((total, message) => total + message.content.length, 0) / 4); }
