import {
  ConversationTitleMaxLength,
  TreeMakerDecisionSchema,
  TopicContextCapsuleSchema,
  type TreeMakerDecision,
  type TreeMakerInput,
  type TreeMakerPreviewRequest,
  type TreeMakerPreviewResponse,
} from '@arborai/shared';
import { buildTreeMakerInput, type TreeMakerInputNode, type TreeMakerInputTopic } from './tree-maker-input.service.js';
import type { AiProvider } from './ai-provider.js';
import { MockAiProvider } from './mock-ai-provider.js';
import { treeMakerDecisionJsonSchema, treeMakerSystemPrompt } from './tree-maker-prompt.js';

export type TreeMakerTopicRecord = TreeMakerInputTopic & { activeNodeId: string | null };
export type TreeMakerNodeRecord = TreeMakerInputNode & { parentId: string | null; contextEnabled: boolean };
export type TreeMakerWorkspaceRecord = { id: string; title: string; activeTopicId: string | null };

export interface TreeMaker {
  decide(input: TreeMakerInput): Promise<unknown>;
}

/** Provider-backed TreeMaker port. It only obtains a placement proposal. */
export class ProviderTreeMaker implements TreeMaker {
  constructor(private readonly provider: AiProvider, private readonly model: string) {}

  decide(input: TreeMakerInput): Promise<unknown> {
    return this.provider.createStructuredOutput({ model: this.model, systemPrompt: treeMakerSystemPrompt, payload: input, schema: TreeMakerDecisionSchema, schemaName: 'tree_maker_decision', jsonSchema: treeMakerDecisionJsonSchema });
  }
}

export interface TreeMakerStore {
  findWorkspace(id: string): Promise<TreeMakerWorkspaceRecord | null>;
  listTopics(workspaceId: string): Promise<TreeMakerTopicRecord[]>;
  listNodes(workspaceId: string): Promise<TreeMakerNodeRecord[]>;
  createRun(data: {
    conversationId: string;
    newPrompt: string;
    activeTopicId: string | null;
    activeNodeId: string | null;
    inputTreeIndex: TreeMakerInput;
    outputDecision: TreeMakerDecision;
    provider: string;
    model: string;
    confidence: number;
    status: 'completed' | 'failed' | 'fallback';
    errorMessage?: string;
  }): Promise<unknown>;
}

export class TreeMakerWorkspaceNotFoundError extends Error {}
export class TreeMakerValidationError extends Error {}

export const defaultTreeMakerConfidencePolicy = { high: 0.85, medium: 0.55 };

/** Offline routing rules deliberately use explicit prompt cues so outcomes are repeatable in tests and demos. */
export class MockTreeMaker implements TreeMaker {
  async decide(input: TreeMakerInput): Promise<TreeMakerDecision> {
    const prompt = input.newPrompt.trim();
    const lower = prompt.toLowerCase();
    if (lower.startsWith('ask:') || /\b(ambiguous|not sure which topic)\b/.test(lower)) {
      return { action: 'ask_user', question: 'Which existing topic should this belong to?', suggestedTopicIds: input.topics.slice(0, 3).map((topic) => topic.id), confidence: 0.4, reasoning: 'The prompt explicitly indicates ambiguous placement.' };
    }
    if (lower.startsWith('subtopic:') && input.activeTopicId) {
      return { action: 'create_subtopic', parentTopicId: input.activeTopicId, title: deriveTitle(prompt.slice('subtopic:'.length)), description: null, provisionalCapsule: null, confidence: 0.7, reasoning: 'The prompt explicitly requests a related subtopic.' };
    }
    if (lower.startsWith('root:') || lower.startsWith('new topic:')) {
      const prefixLength = lower.startsWith('root:') ? 'root:'.length : 'new topic:'.length;
      return { action: 'create_root_topic', title: deriveTitle(prompt.slice(prefixLength)), description: null, provisionalCapsule: null, confidence: 0.9, reasoning: 'The prompt explicitly requests an independent topic.' };
    }
    if (input.activeTopicId) {
      return { action: 'continue_topic', topicId: input.activeTopicId, anchorNodeId: input.activeNodeId, confidence: 0.9, reasoning: 'The active topic is a valid default for an ordinary follow-up.' };
    }
    return { action: 'create_root_topic', title: deriveTitle(prompt), description: null, provisionalCapsule: null, confidence: 0.9, reasoning: 'There is no valid active topic to continue.' };
  }
}

/**
 * Application orchestration owns persistence of the audit record. It does not
 * create or modify topics, nodes, or active pointers; later generation work
 * applies an already validated placement.
 */
export class TreeMakerApplicationService {
  constructor(
    private readonly store: TreeMakerStore,
    private readonly treeMaker: TreeMaker = new ProviderTreeMaker(new MockAiProvider(), 'mock-tree-maker'),
    private readonly provider = 'mock',
    private readonly model = 'mock-tree-maker',
    private readonly policy = defaultTreeMakerConfidencePolicy,
  ) {}

  async preview(workspaceId: string, request: TreeMakerPreviewRequest): Promise<TreeMakerPreviewResponse> {
    const workspace = await this.store.findWorkspace(workspaceId);
    if (!workspace) throw new TreeMakerWorkspaceNotFoundError();
    const [topics, nodes] = await Promise.all([this.store.listTopics(workspaceId), this.store.listNodes(workspaceId)]);
    const active = resolveActiveSelection(request, workspace, topics, nodes);
    const input = buildTreeMakerInput({
      workspace: { id: workspace.id, title: workspace.title }, topics, nodes,
      activeTopicId: active.topicId, activeNodeId: active.nodeId, newPrompt: request.prompt,
    });

    try {
      const proposed = await this.treeMaker.decide(input);
      let decision = validateTreeMakerDecision(proposed, workspaceId, topics, nodes);
      if (decision.confidence < this.policy.medium && decision.action !== 'ask_user') {
        decision = clarificationDecision(decision, input);
      }
      await this.persist(workspaceId, request.prompt, active, input, decision, 'completed');
      return { decision, requiresConfirmation: decision.action === 'ask_user' || decision.confidence < this.policy.medium };
    } catch (error) {
      const fallback = fallbackDecision(request.prompt, active);
      await this.persist(workspaceId, request.prompt, active, input, fallback, 'fallback', error instanceof Error ? error.message : 'TreeMaker returned an invalid result.');
      return { decision: fallback, requiresConfirmation: false };
    }
  }

  private async persist(workspaceId: string, prompt: string, active: { topicId: string | null; nodeId: string | null }, input: TreeMakerInput, decision: TreeMakerDecision, status: 'completed' | 'fallback', errorMessage?: string) {
    await this.store.createRun({ conversationId: workspaceId, newPrompt: prompt, activeTopicId: active.topicId, activeNodeId: active.nodeId, inputTreeIndex: input, outputDecision: decision, provider: this.provider, model: this.model, confidence: decision.confidence, status, ...(errorMessage ? { errorMessage } : {}) });
  }
}

export function validateTreeMakerDecision(value: unknown, workspaceId: string, topics: TreeMakerTopicRecord[], nodes: TreeMakerNodeRecord[]): TreeMakerDecision {
  const parsed = TreeMakerDecisionSchema.safeParse(value);
  if (!parsed.success) throw new TreeMakerValidationError(parsed.errors.join('; '));
  const decision = parsed.data;
  const topicById = new Map(topics.filter((topic) => topic.conversationId === workspaceId).map((topic) => [topic.id, topic]));
  const nodeById = new Map(nodes.filter((node) => node.conversationId === workspaceId).map((node) => [node.id, node]));
  const validTopic = (id: string) => {
    const topic = topicById.get(id);
    if (!topic) throw new TreeMakerValidationError('Referenced topic does not belong to the workspace.');
    assertRoutableTopic(topic, topicById);
    return topic;
  };
  const validTitle = (title: string) => {
    if (title.trim().length === 0 || title.length > ConversationTitleMaxLength) throw new TreeMakerValidationError(`Generated title must be between 1 and ${ConversationTitleMaxLength} characters.`);
  };
  if (decision.action === 'continue_topic') {
    validTopic(decision.topicId);
    if (decision.anchorNodeId) {
      const anchor = nodeById.get(decision.anchorNodeId);
      if (!anchor || anchor.topicId !== decision.topicId || anchor.prunedAt !== null) throw new TreeMakerValidationError('Anchor node must belong to the selected visible topic.');
    }
  } else if (decision.action === 'create_subtopic') {
    validTopic(decision.parentTopicId);
    validTitle(decision.title);
    validateCapsule(decision.provisionalCapsule, topicById, nodeById);
  } else if (decision.action === 'create_root_topic') {
    validTitle(decision.title);
    validateCapsule(decision.provisionalCapsule, topicById, nodeById);
  } else {
    for (const topicId of decision.suggestedTopicIds) validTopic(topicId);
  }
  return decision;
}

function resolveActiveSelection(request: TreeMakerPreviewRequest, workspace: TreeMakerWorkspaceRecord, topics: TreeMakerTopicRecord[], nodes: TreeMakerNodeRecord[]) {
  const requestedTopicId = request.activeTopicId ?? workspace.activeTopicId;
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const topic = requestedTopicId ? topicById.get(requestedTopicId) : undefined;
  if (!topic || topic.conversationId !== workspace.id || !isRoutableTopic(topic, topicById)) return { topicId: null, nodeId: null };
  const node = request.activeNodeId ? nodes.find((candidate) => candidate.id === request.activeNodeId) : undefined;
  return { topicId: topic.id, nodeId: node && node.conversationId === workspace.id && node.topicId === topic.id && node.prunedAt === null ? node.id : null };
}

function assertRoutableTopic(topic: TreeMakerTopicRecord, topicById: Map<string, TreeMakerTopicRecord>) {
  if (!isRoutableTopic(topic, topicById)) throw new TreeMakerValidationError('Referenced topic is archived, context-disabled, or has an invalid topic lineage.');
}

function isRoutableTopic(topic: TreeMakerTopicRecord, topicById: Map<string, TreeMakerTopicRecord>) {
  const seen = new Set<string>();
  let current: TreeMakerTopicRecord | undefined = topic;
  while (current) {
    if (seen.has(current.id) || current.archivedAt !== null || !current.contextEnabled) return false;
    seen.add(current.id);
    if (!current.parentTopicId) return true;
    current = topicById.get(current.parentTopicId);
    if (!current) return false;
  }
  return false;
}

function validateCapsule(capsule: unknown, topicById: Map<string, TreeMakerTopicRecord>, nodeById: Map<string, TreeMakerNodeRecord>) {
  if (capsule === null) return;
  const parsed = TopicContextCapsuleSchema.safeParse(capsule);
  if (!parsed.success) throw new TreeMakerValidationError('Provisional capsule is invalid.');
  if (parsed.data.sourceTopicIds.some((id) => !topicById.has(id)) || parsed.data.sourceNodeIds.some((id) => !nodeById.has(id))) {
    throw new TreeMakerValidationError('Provisional capsule references content outside the workspace.');
  }
}

function clarificationDecision(decision: TreeMakerDecision, input: TreeMakerInput): TreeMakerDecision {
  return { action: 'ask_user', question: 'Which topic should this prompt belong to?', suggestedTopicIds: decision.action === 'continue_topic' ? [decision.topicId] : input.topics.slice(0, 3).map((topic) => topic.id), confidence: decision.confidence, reasoning: `${decision.reasoning} Confidence is below the automatic-routing threshold.` };
}

function fallbackDecision(prompt: string, active: { topicId: string | null; nodeId: string | null }): TreeMakerDecision {
  if (active.topicId) return { action: 'continue_topic', topicId: active.topicId, anchorNodeId: active.nodeId, confidence: 0.85, reasoning: 'Safe fallback continued the valid active topic after TreeMaker validation failed.' };
  const title = deriveTitle(prompt);
  return { action: 'create_root_topic', title, description: null, provisionalCapsule: null, confidence: 0.85, reasoning: 'Safe fallback created a prompt-derived root placement because no valid active topic exists.' };
}

function deriveTitle(value: string) {
  const cleaned = value.trim().replace(/^(subtopic:|root:|new topic:)\s*/i, '');
  const sentence = cleaned.split(/[.?!\n]/, 1)[0].trim() || 'New topic';
  return sentence.length <= ConversationTitleMaxLength ? sentence : sentence.slice(0, ConversationTitleMaxLength).trim();
}
