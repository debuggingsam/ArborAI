import {
  GenerationResponseSchema,
  type TopicContextCapsule,
  type ContextPreviewResponse,
  type GenerationRequest,
  type GenerationResponse,
  type ModelMessage,
} from '@arborai/shared';
import type { AiProvider } from './ai-provider.js';
import { ContextEngine, type ContextEngineNode, type ContextEngineTopic, type ContextEngineWorkspace } from './context-engine.service.js';
import type { TreeMakerApplicationService } from './tree-maker.service.js';

export type GenerationWorkspace = ContextEngineWorkspace & { title: string; activeTopicId: string | null };
export type GenerationTopic = ContextEngineTopic & { description: string | null };
export type GenerationNode = ContextEngineNode & { status: 'pending' | 'streaming' | 'completed' | 'error'; errorMessage: string | null };
export type GenerationPlacement = { topicId: string; anchorNodeId: string | null; prompt: string; provider?: string; model?: string; createTopic?: { parentTopicId: string | null; title: string; description: string | null; createdBy: 'user' | 'tree_maker' } };
export type InitializedGeneration = { generationId: string; topicId: string; userNodeId: string; assistantNodeId: string; context: ContextPreviewResponse; createdTopicId: string | null };

export interface GenerationStore {
  findWorkspace(id: string): Promise<GenerationWorkspace | null>;
  listTopics(workspaceId: string): Promise<GenerationTopic[]>;
  listNodes(workspaceId: string): Promise<GenerationNode[]>;
  initialize(workspaceId: string, request: GenerationRequest, placement: GenerationPlacement, context: ContextPreviewResponse, treeMakerRunId: string | null): Promise<InitializedGeneration>;
  markStreaming(generationId: string, assistantNodeId: string): Promise<void>;
  appendDelta(assistantNodeId: string, delta: string): Promise<void>;
  complete(generationId: string, assistantNodeId: string, inputTokens: number | null, outputTokens: number | null): Promise<void>;
  fail(generationId: string, assistantNodeId: string, error: string): Promise<void>;
}

export type GenerationEvent =
  | { type: 'tree_maker.completed'; workspaceId: string; generationId: null; decision: unknown }
  | { type: 'tree_maker.clarification_required'; workspaceId: string; generationId: null; question: string; suggestedTopicIds: string[] }
  | { type: 'topic.created'; workspaceId: string; generationId: string; topic: unknown }
  | { type: 'node.created'; workspaceId: string; generationId: string; node: unknown }
  | { type: 'assistant.delta'; workspaceId: string; generationId: string; assistantNodeId: string; delta: string }
  | { type: 'assistant.completed'; workspaceId: string; generationId: string; assistantNodeId: string; content: string }
  | { type: 'capsule.updated'; workspaceId: string; generationId: string; topicId: string; capsule: TopicContextCapsule }
  | { type: 'assistant.failed'; workspaceId: string; generationId: string; assistantNodeId: string; error: string };
export type GenerationEventPublisher = { publish(event: GenerationEvent): void };
export type GenerationCompletionHandler = (input: { topicId: string; userNodeId: string; assistantNodeId: string; userPrompt: string; assistantResponse: string }) => Promise<TopicContextCapsule | null>;

export class GenerationWorkspaceNotFoundError extends Error {}
export class GenerationValidationError extends Error {}

/** Coordinates routing, atomic graph creation, immutable snapshots, and answer lifecycle. */
export class GenerationApplicationService {
  constructor(
    private readonly store: GenerationStore,
    private readonly provider: AiProvider,
    private readonly answerModel: string,
    private readonly treeMaker: TreeMakerApplicationService,
    private readonly contextEngine = new ContextEngine(),
    private readonly maxInputTokens: number | null = null,
    private readonly events: GenerationEventPublisher = { publish() {} },
    private readonly afterCompletion?: GenerationCompletionHandler,
  ) {}

  async start(workspaceId: string, request: GenerationRequest): Promise<GenerationResponse> {
    const workspace = await this.store.findWorkspace(workspaceId);
    if (!workspace) throw new GenerationWorkspaceNotFoundError();
    const [topics, nodes] = await Promise.all([this.store.listTopics(workspaceId), this.store.listNodes(workspaceId)]);
    const routed = await this.resolvePlacement(workspaceId, request, workspace, topics, nodes);
    if ('clarification' in routed) return GenerationResponseSchema.parse({ generationId: null, treeMakerRunId: null, topicId: null, userNodeId: null, assistantNodeId: null, status: 'clarification_required', clarification: routed.clarification });
    const placement = { ...routed.placement, provider: this.provider.name, model: this.answerModel };
    const context = this.contextEngine.assemble({ workspace, topics: projectedTopics(topics, placement, workspaceId), nodes, topicId: placement.topicId, anchorNodeId: placement.anchorNodeId, newPrompt: placement.prompt, maxInputTokens: this.maxInputTokens });
    const initialized = await this.store.initialize(workspaceId, request, placement, context, null);
    const now = new Date().toISOString();
    if (placement.createTopic) this.events.publish({ type: 'topic.created', workspaceId, generationId: initialized.generationId, topic: { id: placement.topicId, conversationId: workspaceId, parentTopicId: placement.createTopic.parentTopicId, title: placement.createTopic.title, description: placement.createTopic.description, activeNodeId: initialized.assistantNodeId, contextEnabled: true, archivedAt: null, createdBy: placement.createTopic.createdBy, createdAt: now, updatedAt: now } });
    const existingUser = nodes.find((node) => node.id === initialized.userNodeId);
    this.events.publish({ type: 'node.created', workspaceId, generationId: initialized.generationId, node: existingUser ? nodeDto(existingUser) : nodeDto({ id: initialized.userNodeId, conversationId: workspaceId, topicId: initialized.topicId, parentId: placement.anchorNodeId, role: 'user', content: placement.prompt, status: 'completed', contextEnabled: true, pinned: false, errorMessage: null, prunedAt: null, createdAt: now }) });
    this.events.publish({ type: 'node.created', workspaceId, generationId: initialized.generationId, node: nodeDto({ id: initialized.assistantNodeId, conversationId: workspaceId, topicId: initialized.topicId, parentId: initialized.userNodeId, role: 'assistant', content: '', status: 'pending', contextEnabled: true, pinned: false, errorMessage: null, prunedAt: null, createdAt: now }) });
    void this.execute(workspaceId, initialized, context.messages);
    return GenerationResponseSchema.parse({ generationId: initialized.generationId, treeMakerRunId: null, topicId: initialized.topicId, userNodeId: initialized.userNodeId, assistantNodeId: initialized.assistantNodeId, status: 'accepted', clarification: null });
  }

  private async resolvePlacement(workspaceId: string, request: GenerationRequest, workspace: GenerationWorkspace, topics: GenerationTopic[], nodes: GenerationNode[]): Promise<{ placement: GenerationPlacement } | { clarification: { question: string; suggestedTopicIds: string[] } }> {
    const topic = (id: string) => topics.find((item) => item.id === id && item.conversationId === workspaceId) ?? null;
    const anchor = (id: string | null, topicId: string) => id && nodes.some((node) => node.id === id && node.topicId === topicId && node.prunedAt === null) ? id : null;
    if (request.mode === 'auto_route') {
      const routed = await this.treeMaker.preview(workspaceId, { prompt: request.prompt, activeTopicId: request.activeTopicId, activeNodeId: request.activeNodeId });
      const decision = routed.decision;
      this.events.publish(decision.action === 'ask_user'
        ? { type: 'tree_maker.clarification_required', workspaceId, generationId: null, question: decision.question, suggestedTopicIds: decision.suggestedTopicIds }
        : { type: 'tree_maker.completed', workspaceId, generationId: null, decision });
      if (decision.action === 'ask_user') return { clarification: { question: decision.question, suggestedTopicIds: decision.suggestedTopicIds } };
      if (decision.action === 'continue_topic') return { placement: { topicId: decision.topicId, anchorNodeId: anchor(decision.anchorNodeId, decision.topicId), prompt: request.prompt } };
      if (decision.action === 'create_subtopic') return { placement: { topicId: crypto.randomUUID(), anchorNodeId: null, prompt: request.prompt, createTopic: { parentTopicId: decision.parentTopicId, title: decision.title, description: decision.description, createdBy: 'tree_maker' } } };
      return { placement: { topicId: crypto.randomUUID(), anchorNodeId: null, prompt: request.prompt, createTopic: { parentTopicId: null, title: decision.title, description: decision.description, createdBy: 'tree_maker' } } };
    }
    if (request.mode === 'manual_continue') { if (!topic(request.topicId)) throw new GenerationValidationError('Selected topic does not belong to the workspace.'); return { placement: { topicId: request.topicId, anchorNodeId: anchor(request.anchorNodeId, request.topicId), prompt: request.prompt } }; }
    if (request.mode === 'manual_subtopic') { if (!topic(request.parentTopicId)) throw new GenerationValidationError('Parent topic does not belong to the workspace.'); return { placement: { topicId: crypto.randomUUID(), anchorNodeId: null, prompt: request.prompt, createTopic: { parentTopicId: request.parentTopicId, title: request.title?.trim() || deriveTitle(request.prompt), description: request.description ?? null, createdBy: 'user' } } }; }
    if (request.mode === 'manual_root_topic') return { placement: { topicId: crypto.randomUUID(), anchorNodeId: null, prompt: request.prompt, createTopic: { parentTopicId: null, title: request.title?.trim() || deriveTitle(request.prompt), description: request.description ?? null, createdBy: 'user' } } };
    const user = nodes.find((node) => node.id === request.userNodeId && node.role === 'user' && node.prunedAt === null);
    if (!user) throw new GenerationValidationError('Regeneration requires a visible user node in the workspace.');
    return { placement: { topicId: user.topicId, anchorNodeId: user.id, prompt: user.content } };
  }

  private async execute(workspaceId: string, initialized: InitializedGeneration, messages: ModelMessage[]) {
    try {
      await this.store.markStreaming(initialized.generationId, initialized.assistantNodeId);
      let inputTokens: number | null = null; let outputTokens: number | null = null; let content = '';
      for await (const event of this.provider.streamAnswer({ model: this.answerModel, messages, generationId: initialized.generationId })) {
        if (event.type === 'text_delta') { content += event.delta; await this.store.appendDelta(initialized.assistantNodeId, event.delta); this.events.publish({ type: 'assistant.delta', workspaceId, generationId: initialized.generationId, assistantNodeId: initialized.assistantNodeId, delta: event.delta }); }
        if (event.type === 'usage') { inputTokens = event.inputTokens; outputTokens = event.outputTokens; }
      }
      await this.store.complete(initialized.generationId, initialized.assistantNodeId, inputTokens, outputTokens);
      this.events.publish({ type: 'assistant.completed', workspaceId, generationId: initialized.generationId, assistantNodeId: initialized.assistantNodeId, content });
      const capsule = await this.afterCompletion?.({ topicId: initialized.topicId, userNodeId: initialized.userNodeId, assistantNodeId: initialized.assistantNodeId, userPrompt: messages.at(-1)?.content ?? '', assistantResponse: content });
      if (capsule) this.events.publish({ type: 'capsule.updated', workspaceId, generationId: initialized.generationId, topicId: initialized.topicId, capsule });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed.';
      await this.store.fail(initialized.generationId, initialized.assistantNodeId, message);
      this.events.publish({ type: 'assistant.failed', workspaceId, generationId: initialized.generationId, assistantNodeId: initialized.assistantNodeId, error: message });
    }
  }
}

function projectedTopics(topics: GenerationTopic[], placement: GenerationPlacement, workspaceId: string): GenerationTopic[] {
  if (!placement.createTopic) return topics;
  return [...topics, { id: placement.topicId, conversationId: workspaceId, parentTopicId: placement.createTopic.parentTopicId, title: placement.createTopic.title, contextEnabled: true, archivedAt: null, contextCapsule: null, description: placement.createTopic.description }];
}
function deriveTitle(prompt: string) { return prompt.trim().split(/[.?!\n]/, 1)[0]?.slice(0, 200).trim() || 'New topic'; }
function nodeDto(node: { id: string; conversationId: string; topicId: string; parentId: string | null; role: string; content: string; status: string; contextEnabled: boolean; pinned: boolean; errorMessage: string | null; prunedAt: Date | string | null; createdAt: Date | string; updatedAt?: Date | string }) { const createdAt = typeof node.createdAt === 'string' ? node.createdAt : node.createdAt.toISOString(); return { ...node, createdAt, updatedAt: node.updatedAt ? (typeof node.updatedAt === 'string' ? node.updatedAt : node.updatedAt.toISOString()) : createdAt, prunedAt: node.prunedAt ? (typeof node.prunedAt === 'string' ? node.prunedAt : node.prunedAt.toISOString()) : null, tokenCount: null }; }
