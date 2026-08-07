/** Runtime-validated public contracts shared by the API, web app, and future gateway. */
export type ValidationResult<T> = { success: true; data: T } | { success: false; errors: string[] };
export interface RuntimeSchema<T> {
  safeParse(value: unknown): ValidationResult<T>;
  parse(value: unknown): T;
}
export type InferSchema<T extends RuntimeSchema<unknown>> = T extends RuntimeSchema<infer Output> ? Output : never;

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonEmpty);
const optionalString = (value: unknown): value is string | undefined => value === undefined || typeof value === 'string';
const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';
const result = <T>(value: unknown, checks: Array<[string, boolean]>): ValidationResult<T> => {
  const errors = checks.filter(([, valid]) => !valid).map(([message]) => message);
  return errors.length === 0 ? { success: true, data: value as T } : { success: false, errors };
};
const schema = <T>(validate: (value: unknown) => ValidationResult<T>): RuntimeSchema<T> => ({
  safeParse: validate,
  parse(value) { const checked = validate(value); if (!checked.success) throw new Error(checked.errors.join('; ')); return checked.data; },
});
export const NodeRole = { System: 'system', User: 'user', Assistant: 'assistant' } as const;
export type NodeRole = (typeof NodeRole)[keyof typeof NodeRole];
export const NodeStatus = { Pending: 'pending', Streaming: 'streaming', Completed: 'completed', Error: 'error' } as const;
export type NodeStatus = (typeof NodeStatus)[keyof typeof NodeStatus];
export const TopicCreatedBy = { User: 'user', TreeMaker: 'tree_maker', Migration: 'migration' } as const;
export type TopicCreatedBy = (typeof TopicCreatedBy)[keyof typeof TopicCreatedBy];
export const GenerationMode = { AutoRoute: 'auto_route', ManualContinue: 'manual_continue', ManualSubtopic: 'manual_subtopic', ManualRootTopic: 'manual_root_topic', Regenerate: 'regenerate' } as const;
export type GenerationMode = (typeof GenerationMode)[keyof typeof GenerationMode];
export const GenerationStatus = { Accepted: 'accepted', ClarificationRequired: 'clarification_required', Pending: 'pending', Streaming: 'streaming', Completed: 'completed', Error: 'error' } as const;
export type GenerationStatus = (typeof GenerationStatus)[keyof typeof GenerationStatus];

export const ContextExclusionReason = {
  UnrelatedRootTopic: 'unrelated_root_topic', SiblingTopic: 'sibling_topic', TopicContextDisabled: 'topic_context_disabled', AncestorTopicContextDisabled: 'ancestor_topic_context_disabled', TopicArchived: 'topic_archived', AlternativeBranchNotSelected: 'alternative_branch_not_selected', MessageContextDisabled: 'message_context_disabled', MessagePruned: 'message_pruned', TokenBudget: 'token_budget',
} as const;
export type ContextExclusionReason = (typeof ContextExclusionReason)[keyof typeof ContextExclusionReason];
export const ContextWarningCode = { ContextGap: 'context_gap', MissingActiveNode: 'missing_active_node', InvalidParentReference: 'invalid_parent_reference', CapsuleMissing: 'capsule_missing', TokenBudgetTooSmall: 'token_budget_too_small' } as const;
export type ContextWarningCode = (typeof ContextWarningCode)[keyof typeof ContextWarningCode];

export const TopicContextCapsuleSummaryMaxLength = 600;
export const TopicContextCapsuleEntryMaxLength = 240;
export const TopicContextCapsuleEntriesMaxCount = 16;
export const TopicContextCapsuleSourceIdsMaxCount = 100;

type TopicContextCapsuleShape = { summary: string; facts: string[]; decisions: string[]; constraints: string[]; openQuestions: string[]; sourceTopicIds: string[]; sourceNodeIds: string[] };
export const TopicContextCapsuleSchema: RuntimeSchema<TopicContextCapsuleShape> = schema((value) => {
  if (!record(value)) return { success: false, errors: ['capsule must be an object'] };
  const boundedEntries = (entry: unknown): entry is string[] => stringArray(entry)
    && entry.length <= TopicContextCapsuleEntriesMaxCount
    && entry.every((item) => item.length <= TopicContextCapsuleEntryMaxLength);
  const sourceIds = (entry: unknown): entry is string[] => stringArray(entry) && entry.length <= TopicContextCapsuleSourceIdsMaxCount;
  return result(value, [
    [`summary must be a non-empty string of at most ${TopicContextCapsuleSummaryMaxLength} characters`, nonEmpty(value.summary) && value.summary.length <= TopicContextCapsuleSummaryMaxLength],
    [`facts must contain at most ${TopicContextCapsuleEntriesMaxCount} non-empty entries of at most ${TopicContextCapsuleEntryMaxLength} characters`, boundedEntries(value.facts)],
    [`decisions must contain at most ${TopicContextCapsuleEntriesMaxCount} non-empty entries of at most ${TopicContextCapsuleEntryMaxLength} characters`, boundedEntries(value.decisions)],
    [`constraints must contain at most ${TopicContextCapsuleEntriesMaxCount} non-empty entries of at most ${TopicContextCapsuleEntryMaxLength} characters`, boundedEntries(value.constraints)],
    [`openQuestions must contain at most ${TopicContextCapsuleEntriesMaxCount} non-empty entries of at most ${TopicContextCapsuleEntryMaxLength} characters`, boundedEntries(value.openQuestions)],
    [`sourceTopicIds must contain at most ${TopicContextCapsuleSourceIdsMaxCount} IDs`, sourceIds(value.sourceTopicIds)],
    [`sourceNodeIds must contain at most ${TopicContextCapsuleSourceIdsMaxCount} IDs`, sourceIds(value.sourceNodeIds)],
  ]);
});
export type TopicContextCapsule = InferSchema<typeof TopicContextCapsuleSchema>;

type WorkspaceShape = { id: string; title: string; systemPrompt: string; activeTopicId: string | null; createdAt: string; updatedAt: string };
export const WorkspaceSchema: RuntimeSchema<WorkspaceShape> = schema((value) => {
  if (!record(value)) return { success: false, errors: ['workspace must be an object'] };
  return result(value, [['id must be a non-empty string', nonEmpty(value.id)], ['title must be a non-empty string', nonEmpty(value.title)], ['systemPrompt must be a string', typeof value.systemPrompt === 'string'], ['activeTopicId must be a string or null', nullableString(value.activeTopicId)], ['createdAt must be a string', typeof value.createdAt === 'string'], ['updatedAt must be a string', typeof value.updatedAt === 'string']]);
});
export type Workspace = InferSchema<typeof WorkspaceSchema>;
/** Compatibility persistence name; new product contracts should use Workspace. */
export type Conversation = Workspace;
export const ConversationSchema = WorkspaceSchema;

type TopicShape = { id: string; conversationId: string; parentTopicId: string | null; title: string; description: string | null; activeNodeId: string | null; contextEnabled: boolean; archivedAt: string | null; contextCapsule?: TopicContextCapsule | null; capsuleVersion?: number; capsuleUpdatedAt?: string | null; createdBy?: TopicCreatedBy; createdAt: string; updatedAt: string };
export const TopicSchema: RuntimeSchema<TopicShape> = schema((value) => {
  if (!record(value)) return { success: false, errors: ['topic must be an object'] };
  const capsule = value.contextCapsule === undefined || value.contextCapsule === null || TopicContextCapsuleSchema.safeParse(value.contextCapsule).success;
  return result(value, [['id must be a non-empty string', nonEmpty(value.id)], ['conversationId must be a non-empty string', nonEmpty(value.conversationId)], ['parentTopicId must be a string or null', nullableString(value.parentTopicId)], ['title must be a non-empty string', nonEmpty(value.title)], ['description must be a string or null', nullableString(value.description)], ['activeNodeId must be a string or null', nullableString(value.activeNodeId)], ['contextEnabled must be a boolean', typeof value.contextEnabled === 'boolean'], ['archivedAt must be a string or null', nullableString(value.archivedAt)], ['contextCapsule must be a valid capsule or null', capsule], ['capsuleVersion must be a non-negative integer when provided', value.capsuleVersion === undefined || (Number.isInteger(value.capsuleVersion) && (value.capsuleVersion as number) >= 0)], ['capsuleUpdatedAt must be a string or null when provided', value.capsuleUpdatedAt === undefined || nullableString(value.capsuleUpdatedAt)], ['createdBy must be valid when provided', value.createdBy === undefined || Object.values(TopicCreatedBy).includes(value.createdBy as TopicCreatedBy)], ['createdAt must be a string', typeof value.createdAt === 'string'], ['updatedAt must be a string', typeof value.updatedAt === 'string']]);
});
export type Topic = InferSchema<typeof TopicSchema>;
export type TopicDto = Topic;

type MessageNodeShape = { id: string; conversationId: string; topicId: string; parentId: string | null; role: NodeRole; content: string; status: NodeStatus; tokenCount: number | null; contextEnabled: boolean; pinned: boolean; errorMessage: string | null; prunedAt: string | null; createdAt: string; updatedAt: string };
export const MessageNodeSchema: RuntimeSchema<MessageNodeShape> = schema((value) => {
  if (!record(value)) return { success: false, errors: ['message node must be an object'] };
  return result(value, [['id must be a non-empty string', nonEmpty(value.id)], ['conversationId must be a non-empty string', nonEmpty(value.conversationId)], ['topicId must be a non-empty string', nonEmpty(value.topicId)], ['parentId must be a string or null', nullableString(value.parentId)], ['role must be valid', Object.values(NodeRole).includes(value.role as NodeRole)], ['content must be a string', typeof value.content === 'string'], ['status must be valid', Object.values(NodeStatus).includes(value.status as NodeStatus)], ['tokenCount must be a number or null', value.tokenCount === null || typeof value.tokenCount === 'number'], ['contextEnabled must be a boolean', typeof value.contextEnabled === 'boolean'], ['pinned must be a boolean', typeof value.pinned === 'boolean'], ['errorMessage must be a string or null', nullableString(value.errorMessage)], ['prunedAt must be a string or null', nullableString(value.prunedAt)], ['createdAt must be a string', typeof value.createdAt === 'string'], ['updatedAt must be a string', typeof value.updatedAt === 'string']]);
});
export type MessageNode = InferSchema<typeof MessageNodeSchema>;
export type ConversationNode = MessageNode;
export const ConversationNodeSchema = MessageNodeSchema;

type TreeMakerTopicIndexShape = { id: string; parentTopicId: string | null; title: string; description: string | null; capsuleSummary: string | null; recentActivity: string | null; contextEnabled: boolean; archived: boolean; childTopicCount: number; messageCount: number };
export const TreeMakerTopicIndexSchema: RuntimeSchema<TreeMakerTopicIndexShape> = schema((value) => {
  if (!record(value)) return { success: false, errors: ['tree topic must be an object'] };
  return result(value, [['id must be a non-empty string', nonEmpty(value.id)], ['parentTopicId must be a string or null', nullableString(value.parentTopicId)], ['title must be a non-empty string', nonEmpty(value.title)], ['description must be a string or null', nullableString(value.description)], ['capsuleSummary must be a string or null', nullableString(value.capsuleSummary)], ['recentActivity must be a string or null', nullableString(value.recentActivity)], ['contextEnabled must be a boolean', typeof value.contextEnabled === 'boolean'], ['archived must be a boolean', typeof value.archived === 'boolean'], ['childTopicCount must be a non-negative integer', Number.isInteger(value.childTopicCount) && (value.childTopicCount as number) >= 0], ['messageCount must be a non-negative integer', Number.isInteger(value.messageCount) && (value.messageCount as number) >= 0]]);
});
export type TreeMakerTopicIndex = InferSchema<typeof TreeMakerTopicIndexSchema>;
type TreeMakerInputShape = { workspace: { id: string; title: string }; activeTopicId: string | null; activeNodeId: string | null; topics: TreeMakerTopicIndex[]; recentMessagesByTopic: Record<string, Array<{ id: string; role: 'user' | 'assistant'; contentPreview: string }>>; newPrompt: string };
export const TreeMakerInputSchema: RuntimeSchema<TreeMakerInputShape> = schema((value) => {
  if (!record(value)) return { success: false, errors: ['TreeMaker input must be an object'] };
  const workspace = record(value.workspace) && nonEmpty(value.workspace.id) && nonEmpty(value.workspace.title);
  const previews = record(value.recentMessagesByTopic) && Object.entries(value.recentMessagesByTopic).every(([topicId, messages]) => nonEmpty(topicId) && Array.isArray(messages) && messages.every((message) => record(message) && nonEmpty(message.id) && (message.role === NodeRole.User || message.role === NodeRole.Assistant) && typeof message.contentPreview === 'string'));
  return result(value, [['workspace must contain a non-empty ID and title', workspace], ['newPrompt must be a non-empty string', nonEmpty(value.newPrompt)], ['activeTopicId must be a string or null', nullableString(value.activeTopicId)], ['activeNodeId must be a string or null', nullableString(value.activeNodeId)], ['topics must be valid', Array.isArray(value.topics) && value.topics.every((topic) => TreeMakerTopicIndexSchema.safeParse(topic).success)], ['recentMessagesByTopic must be valid', previews]]);
});
export type TreeMakerInput = InferSchema<typeof TreeMakerInputSchema>;

type TreeMakerDecisionBase = { confidence: number; reasoning: string };
export type TreeMakerDecision = (TreeMakerDecisionBase & { action: 'continue_topic'; topicId: string; anchorNodeId: string | null }) | (TreeMakerDecisionBase & { action: 'create_subtopic'; parentTopicId: string; title: string; description: string | null; provisionalCapsule: TopicContextCapsule | null }) | (TreeMakerDecisionBase & { action: 'create_root_topic'; title: string; description: string | null; provisionalCapsule: TopicContextCapsule | null }) | (TreeMakerDecisionBase & { action: 'ask_user'; question: string; suggestedTopicIds: string[] });
export const TreeMakerDecisionSchema: RuntimeSchema<TreeMakerDecision> = schema((value) => {
  if (!record(value)) return { success: false, errors: ['TreeMaker decision must be an object'] };
  const base: Array<[string, boolean]> = [['action must be valid', ['continue_topic', 'create_subtopic', 'create_root_topic', 'ask_user'].includes(value.action as string)], ['confidence must be between 0 and 1', typeof value.confidence === 'number' && value.confidence >= 0 && value.confidence <= 1], ['reasoning must be a non-empty string', nonEmpty(value.reasoning)]];
  if (value.action === 'continue_topic') return result(value, [...base, ['topicId must be a non-empty string', nonEmpty(value.topicId)], ['anchorNodeId must be a string or null', nullableString(value.anchorNodeId)]]);
  if (value.action === 'create_subtopic') return result(value, [...base, ['parentTopicId must be a non-empty string', nonEmpty(value.parentTopicId)], ['title must be a non-empty string', nonEmpty(value.title)], ['description must be a string or null', nullableString(value.description)], ['provisionalCapsule must be valid or null', value.provisionalCapsule === null || TopicContextCapsuleSchema.safeParse(value.provisionalCapsule).success]]);
  if (value.action === 'create_root_topic') return result(value, [...base, ['title must be a non-empty string', nonEmpty(value.title)], ['description must be a string or null', nullableString(value.description)], ['provisionalCapsule must be valid or null', value.provisionalCapsule === null || TopicContextCapsuleSchema.safeParse(value.provisionalCapsule).success]]);
  return result(value, [...base, ['question must be a non-empty string', nonEmpty(value.question)], ['suggestedTopicIds must be an array of IDs', stringArray(value.suggestedTopicIds)]]);
});

type TreeMakerPreviewRequestShape = { prompt: string; activeTopicId: string | null; activeNodeId: string | null };
export const TreeMakerPreviewRequestSchema: RuntimeSchema<TreeMakerPreviewRequestShape> = schema((value) => !record(value) ? { success: false, errors: ['TreeMaker preview request must be an object'] } : result(value, [['prompt must be a non-empty string', nonEmpty(value.prompt)], ['activeTopicId must be a string or null', nullableString(value.activeTopicId)], ['activeNodeId must be a string or null', nullableString(value.activeNodeId)]]));
export type TreeMakerPreviewRequest = InferSchema<typeof TreeMakerPreviewRequestSchema>;
type TreeMakerPreviewResponseShape = { decision: TreeMakerDecision; requiresConfirmation: boolean };
export const TreeMakerPreviewResponseSchema: RuntimeSchema<TreeMakerPreviewResponseShape> = schema((value) => !record(value) ? { success: false, errors: ['TreeMaker preview response must be an object'] } : result(value, [['decision must be valid', TreeMakerDecisionSchema.safeParse(value.decision).success], ['requiresConfirmation must be a boolean', typeof value.requiresConfirmation === 'boolean']]));
export type TreeMakerPreviewResponse = InferSchema<typeof TreeMakerPreviewResponseSchema>;

type ContextExclusionShape = { targetType: 'topic' | 'node'; targetId: string; reason: ContextExclusionReason };
export const ContextExclusionSchema: RuntimeSchema<ContextExclusionShape> = schema((value) => !record(value) ? { success: false, errors: ['context exclusion must be an object'] } : result(value, [['targetType must be topic or node', value.targetType === 'topic' || value.targetType === 'node'], ['targetId must be a non-empty string', nonEmpty(value.targetId)], ['reason must be valid', Object.values(ContextExclusionReason).includes(value.reason as ContextExclusionReason)]]));
export type ContextExclusion = InferSchema<typeof ContextExclusionSchema>;
type ContextWarningShape = { code: ContextWarningCode; message: string; topicId?: string; nodeId?: string };
export const ContextWarningSchema: RuntimeSchema<ContextWarningShape> = schema((value) => !record(value) ? { success: false, errors: ['context warning must be an object'] } : result(value, [['code must be valid', Object.values(ContextWarningCode).includes(value.code as ContextWarningCode)], ['message must be a non-empty string', nonEmpty(value.message)], ['topicId must be a string when provided', optionalString(value.topicId)], ['nodeId must be a string when provided', optionalString(value.nodeId)]]));
export type ContextWarning = InferSchema<typeof ContextWarningSchema>;

type ContextPreviewRequestShape = { topicId: string; anchorNodeId: string | null; newPrompt: string; maxInputTokens?: number };
export const ContextPreviewRequestSchema: RuntimeSchema<ContextPreviewRequestShape> = schema((value) => !record(value) ? { success: false, errors: ['context preview request must be an object'] } : result(value, [['topicId must be a non-empty string', nonEmpty(value.topicId)], ['anchorNodeId must be a string or null', nullableString(value.anchorNodeId)], ['newPrompt must be a non-empty string', nonEmpty(value.newPrompt)], ['maxInputTokens must be a positive integer when provided', value.maxInputTokens === undefined || (Number.isInteger(value.maxInputTokens) && (value.maxInputTokens as number) > 0)]]));
export type ContextPreviewRequest = InferSchema<typeof ContextPreviewRequestSchema>;
export const ContextMessageSourceType = { WorkspaceSystemPrompt: 'workspace_system_prompt', TopicCapsule: 'topic_capsule', MessageNode: 'message_node', NewPrompt: 'new_prompt' } as const;
export type ContextMessageSourceType = (typeof ContextMessageSourceType)[keyof typeof ContextMessageSourceType];
/** Source metadata is required in context-preview/snapshots and optional for provider-only calls. */
export type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string; sourceType?: ContextMessageSourceType; sourceId?: string | null };
type ContextPreviewResponseShape = { messages: ModelMessage[]; includedTopicIds: string[]; includedNodeIds: string[]; excludedTopicIds: string[]; excludedNodeIds: string[]; exclusions: ContextExclusion[]; warnings: ContextWarning[]; trimmedNodeIds: string[]; estimatedInputTokens: number; maxInputTokens: number | null };
export const ContextPreviewResponseSchema: RuntimeSchema<ContextPreviewResponseShape> = schema((value) => !record(value) ? { success: false, errors: ['context preview response must be an object'] } : result(value, [['messages must be valid', Array.isArray(value.messages) && value.messages.every((message) => record(message) && ['system', 'user', 'assistant'].includes(message.role as string) && typeof message.content === 'string' && Object.values(ContextMessageSourceType).includes(message.sourceType as ContextMessageSourceType) && nullableString(message.sourceId))], ['includedTopicIds must be IDs', stringArray(value.includedTopicIds)], ['includedNodeIds must be IDs', stringArray(value.includedNodeIds)], ['excludedTopicIds must be IDs', stringArray(value.excludedTopicIds)], ['excludedNodeIds must be IDs', stringArray(value.excludedNodeIds)], ['exclusions must be valid', Array.isArray(value.exclusions) && value.exclusions.every((item) => ContextExclusionSchema.safeParse(item).success)], ['warnings must be valid', Array.isArray(value.warnings) && value.warnings.every((item) => ContextWarningSchema.safeParse(item).success)], ['trimmedNodeIds must be IDs', stringArray(value.trimmedNodeIds)], ['estimatedInputTokens must be non-negative', typeof value.estimatedInputTokens === 'number' && value.estimatedInputTokens >= 0], ['maxInputTokens must be a number or null', value.maxInputTokens === null || typeof value.maxInputTokens === 'number']]));
export type ContextPreviewResponse = InferSchema<typeof ContextPreviewResponseSchema>;

export type GenerationRequest = { mode: 'auto_route'; prompt: string; activeTopicId: string | null; activeNodeId: string | null } | { mode: 'manual_continue'; prompt: string; topicId: string; anchorNodeId: string | null } | { mode: 'manual_subtopic'; prompt: string; parentTopicId: string; title?: string; description?: string | null } | { mode: 'manual_root_topic'; prompt: string; title?: string; description?: string | null } | { mode: 'regenerate'; userNodeId: string };
export const GenerationRequestSchema: RuntimeSchema<GenerationRequest> = schema((value) => {
  if (!record(value)) return { success: false, errors: ['generation request must be an object'] };
  if (value.mode === 'auto_route') return result(value, [['prompt must be a non-empty string', nonEmpty(value.prompt)], ['activeTopicId must be a string or null', nullableString(value.activeTopicId)], ['activeNodeId must be a string or null', nullableString(value.activeNodeId)]]);
  if (value.mode === 'manual_continue') return result(value, [['prompt must be a non-empty string', nonEmpty(value.prompt)], ['topicId must be a non-empty string', nonEmpty(value.topicId)], ['anchorNodeId must be a string or null', nullableString(value.anchorNodeId)]]);
  if (value.mode === 'manual_subtopic') return result(value, [['prompt must be a non-empty string', nonEmpty(value.prompt)], ['parentTopicId must be a non-empty string', nonEmpty(value.parentTopicId)], ['title must be a string when provided', optionalString(value.title)], ['description must be a string or null when provided', value.description === undefined || nullableString(value.description)]]);
  if (value.mode === 'manual_root_topic') return result(value, [['prompt must be a non-empty string', nonEmpty(value.prompt)], ['title must be a string when provided', optionalString(value.title)], ['description must be a string or null when provided', value.description === undefined || nullableString(value.description)]]);
  if (value.mode === 'regenerate') return result(value, [['userNodeId must be a non-empty string', nonEmpty(value.userNodeId)]]);
  return { success: false, errors: ['mode must be a supported generation mode'] };
});
type GenerationResponseShape = { generationId: string | null; treeMakerRunId: string | null; topicId: string | null; userNodeId: string | null; assistantNodeId: string | null; status: 'accepted' | 'clarification_required'; clarification: { question: string; suggestedTopicIds: string[] } | null };
export const GenerationResponseSchema: RuntimeSchema<GenerationResponseShape> = schema((value) => !record(value) ? { success: false, errors: ['generation response must be an object'] } : result(value, [['generationId must be a string or null', nullableString(value.generationId)], ['treeMakerRunId must be a string or null', nullableString(value.treeMakerRunId)], ['topicId must be a string or null', nullableString(value.topicId)], ['userNodeId must be a string or null', nullableString(value.userNodeId)], ['assistantNodeId must be a string or null', nullableString(value.assistantNodeId)], ['status must be accepted or clarification_required', value.status === 'accepted' || value.status === 'clarification_required'], ['clarification must be valid or null', value.clarification === null || (record(value.clarification) && nonEmpty(value.clarification.question) && stringArray(value.clarification.suggestedTopicIds))]]));
export type GenerationResponse = InferSchema<typeof GenerationResponseSchema>;

export const WebSocketEvent = { ConversationJoin: 'conversation.join', ConversationLeave: 'conversation.leave', ConversationJoined: 'conversation.joined', TreeMakerCompleted: 'tree_maker.completed', TreeMakerClarificationRequired: 'tree_maker.clarification_required', TopicCreated: 'topic.created', TopicUpdated: 'topic.updated', TopicMoved: 'topic.moved', TopicContextUpdated: 'topic.context_updated', TopicArchived: 'topic.archived', TopicRestored: 'topic.restored', NodeCreated: 'node.created', NodeUpdated: 'node.updated', NodeContextUpdated: 'node.context_updated', NodePruned: 'node.pruned', AssistantDelta: 'assistant.delta', AssistantCompleted: 'assistant.completed', AssistantFailed: 'assistant.failed', CapsuleUpdated: 'capsule.updated', GenerationFailed: 'generation.failed', SubtreePruned: 'subtree.pruned' } as const;
export type WebSocketEvent = (typeof WebSocketEvent)[keyof typeof WebSocketEvent];
export type WebSocketPayload = { eventType: 'conversation.join' | 'conversation.leave'; workspaceId: string } | { eventType: 'conversation.joined'; workspaceId: string } | { eventType: 'tree_maker.completed'; decision: TreeMakerDecision } | { eventType: 'tree_maker.clarification_required'; question: string; suggestedTopicIds: string[] } | { eventType: 'topic.created' | 'topic.updated' | 'topic.context_updated' | 'topic.archived' | 'topic.restored'; topic: Topic } | { eventType: 'topic.moved'; topicId: string; parentTopicId: string | null } | { eventType: 'node.created' | 'node.updated' | 'node.context_updated'; node: MessageNode } | { eventType: 'node.pruned' | 'subtree.pruned'; nodeId: string; prunedNodeIds?: string[]; activeNodeId?: string | null } | { eventType: 'assistant.delta'; assistantNodeId: string; delta: string } | { eventType: 'assistant.completed'; assistantNodeId: string; content: string } | { eventType: 'assistant.failed' | 'generation.failed'; assistantNodeId?: string; error: string } | { eventType: 'capsule.updated'; topicId: string; capsule: TopicContextCapsule };
export const WebSocketPayloadSchema: RuntimeSchema<WebSocketPayload> = schema((value) => {
  if (!record(value) || !Object.values(WebSocketEvent).includes(value.eventType as WebSocketEvent)) return { success: false, errors: ['payload eventType must be a centralized event name'] };
  switch (value.eventType) {
    case WebSocketEvent.ConversationJoin: case WebSocketEvent.ConversationLeave: case WebSocketEvent.ConversationJoined:
      return result(value, [['workspaceId must be a non-empty string', nonEmpty(value.workspaceId)]]);
    case WebSocketEvent.TreeMakerCompleted:
      return result(value, [['decision must be a valid TreeMaker decision', TreeMakerDecisionSchema.safeParse(value.decision).success]]);
    case WebSocketEvent.TreeMakerClarificationRequired:
      return result(value, [['question must be a non-empty string', nonEmpty(value.question)], ['suggestedTopicIds must be IDs', stringArray(value.suggestedTopicIds)]]);
    case WebSocketEvent.TopicCreated: case WebSocketEvent.TopicUpdated: case WebSocketEvent.TopicContextUpdated: case WebSocketEvent.TopicArchived: case WebSocketEvent.TopicRestored:
      return result(value, [['topic must be a valid topic', TopicSchema.safeParse(value.topic).success]]);
    case WebSocketEvent.TopicMoved:
      return result(value, [['topicId must be a non-empty string', nonEmpty(value.topicId)], ['parentTopicId must be a string or null', nullableString(value.parentTopicId)]]);
    case WebSocketEvent.NodeCreated: case WebSocketEvent.NodeUpdated: case WebSocketEvent.NodeContextUpdated:
      return result(value, [['node must be a valid message node', MessageNodeSchema.safeParse(value.node).success]]);
    case WebSocketEvent.NodePruned: case WebSocketEvent.SubtreePruned:
      return result(value, [['nodeId must be a non-empty string', nonEmpty(value.nodeId)], ['prunedNodeIds must be IDs when provided', value.prunedNodeIds === undefined || stringArray(value.prunedNodeIds)], ['activeNodeId must be a string or null when provided', value.activeNodeId === undefined || nullableString(value.activeNodeId)]]);
    case WebSocketEvent.AssistantDelta:
      return result(value, [['assistantNodeId must be a non-empty string', nonEmpty(value.assistantNodeId)], ['delta must be a string', typeof value.delta === 'string']]);
    case WebSocketEvent.AssistantCompleted:
      return result(value, [['assistantNodeId must be a non-empty string', nonEmpty(value.assistantNodeId)], ['content must be a string', typeof value.content === 'string']]);
    case WebSocketEvent.AssistantFailed: case WebSocketEvent.GenerationFailed:
      return result(value, [['assistantNodeId must be a string when provided', optionalString(value.assistantNodeId)], ['error must be a non-empty string', nonEmpty(value.error)]]);
    case WebSocketEvent.CapsuleUpdated:
      return result(value, [['topicId must be a non-empty string', nonEmpty(value.topicId)], ['capsule must be valid', TopicContextCapsuleSchema.safeParse(value.capsule).success]]);
  }
  return { success: false, errors: ['payload eventType must be a centralized event name'] };
});
export type WebSocketEventEnvelope = { eventId: string; eventType: WebSocketEvent; workspaceId: string; generationId: string | null; occurredAt: string; payload: WebSocketPayload };
export const WebSocketEventEnvelopeSchema: RuntimeSchema<WebSocketEventEnvelope> = schema((value) => {
  if (!record(value)) return { success: false, errors: ['WebSocket envelope must be an object'] };
  const payload = value.payload;
  const payloadEventType = record(payload) ? payload.eventType : undefined;
  return result(value, [['eventId must be a non-empty string', nonEmpty(value.eventId)], ['eventType must be centralized', Object.values(WebSocketEvent).includes(value.eventType as WebSocketEvent)], ['workspaceId must be a non-empty string', nonEmpty(value.workspaceId)], ['generationId must be a string or null', nullableString(value.generationId)], ['occurredAt must be a string', typeof value.occurredAt === 'string'], ['payload must be a valid event payload', WebSocketPayloadSchema.safeParse(payload).success], ['payload eventType must match envelope eventType', payloadEventType === value.eventType]]);
});

export const ConversationTitleMaxLength = 200;
export const ConversationSystemPromptMaxLength = 10_000;
export interface CreateConversationRequest { title: string; systemPrompt?: string }
export interface CreateTopicRequest { title: string; description?: string; parentTopicId?: string | null }
export interface UpdateTopicRequest { title?: string; description?: string | null }
export interface SetTopicContextRequest { contextEnabled: boolean }
export interface SetNodeContextRequest { contextEnabled: boolean }
export interface SetNodePinRequest { pinned: boolean }
export interface ConversationTreeResponse { conversation: Conversation; topics: Topic[]; nodes: MessageNode[]; activeTopicId: string | null }
export interface CreateBranchRequest { parentNodeId: string }
/** Legacy pre-routing request retained until the generation endpoint is introduced. */
export interface StartGenerationRequest { conversationId: string; parentNodeId: string | null; content: string }
export interface PruneSubtreeResponse { conversationId: string; prunedNodeId: string; prunedNodeCount: number }
export interface BranchComparisonResponse { conversationId: string; nodeIds: string[]; branches: MessageNode[][] }
export type ComparisonSelection = { type: 'topic' | 'node'; id: string };
export type ComparisonSide = { selection: ComparisonSelection; topicPathIds: string[]; messagePathIds: string[]; branchTopicIds: string[]; branchMessageIds: string[] };
export type ComparisonResponse = {
  workspaceId: string;
  nearestCommonTopicId: string | null;
  nearestCommonMessageId: string | null;
  sharedTopicPathIds: string[];
  sharedMessagePathIds: string[];
  left: ComparisonSide;
  right: ComparisonSide;
};
const ComparisonSelectionSchema = schema<ComparisonSelection>((value) => !record(value) ? { success: false, errors: ['comparison selection must be an object'] } : result(value, [['type must be topic or node', value.type === 'topic' || value.type === 'node'], ['id must be a non-empty string', nonEmpty(value.id)]]));
const comparisonSide = (value: unknown): value is ComparisonSide => record(value)
  && ComparisonSelectionSchema.safeParse(value.selection).success
  && stringArray(value.topicPathIds) && stringArray(value.messagePathIds)
  && stringArray(value.branchTopicIds) && stringArray(value.branchMessageIds);
export const ComparisonRequestSchema: RuntimeSchema<{ left: ComparisonSelection; right: ComparisonSelection }> = schema((value) => !record(value) ? { success: false, errors: ['comparison request must be an object'] } : result(value, [['left selection must be valid', ComparisonSelectionSchema.safeParse(value.left).success], ['right selection must be valid', ComparisonSelectionSchema.safeParse(value.right).success], ['selections must be different', record(value.left) && record(value.right) && (value.left.type !== value.right.type || value.left.id !== value.right.id)]]));
export const ComparisonResponseSchema: RuntimeSchema<ComparisonResponse> = schema((value) => !record(value) ? { success: false, errors: ['comparison response must be an object'] } : result(value, [['workspaceId must be a non-empty string', nonEmpty(value.workspaceId)], ['nearestCommonTopicId must be a string or null', nullableString(value.nearestCommonTopicId)], ['nearestCommonMessageId must be a string or null', nullableString(value.nearestCommonMessageId)], ['sharedTopicPathIds must be an array of IDs', stringArray(value.sharedTopicPathIds)], ['sharedMessagePathIds must be an array of IDs', stringArray(value.sharedMessagePathIds)], ['left side must be valid', comparisonSide(value.left)], ['right side must be valid', comparisonSide(value.right)]]));
export function validateCreateConversationRequest(value: unknown): ValidationResult<CreateConversationRequest> { if (!record(value)) return { success: false, errors: ['request must be an object'] }; return result(value, [['title must be a non-empty string', nonEmpty(value.title)], [`title must be at most ${ConversationTitleMaxLength} characters`, typeof value.title === 'string' && value.title.length <= ConversationTitleMaxLength], ['systemPrompt must be a string when provided', optionalString(value.systemPrompt)], [`systemPrompt must be at most ${ConversationSystemPromptMaxLength} characters`, value.systemPrompt === undefined || typeof value.systemPrompt !== 'string' || value.systemPrompt.length <= ConversationSystemPromptMaxLength]]); }
export function validateUpdateConversationRequest(value: unknown): ValidationResult<Partial<CreateConversationRequest> & { activeTopicId?: string | null }> { if (!record(value)) return { success: false, errors: ['request must be an object'] }; const hasTitle = value.title !== undefined; const hasSystemPrompt = value.systemPrompt !== undefined; const hasActiveTopicId = value.activeTopicId !== undefined; return result(value, [['request must include title, systemPrompt, or activeTopicId', hasTitle || hasSystemPrompt || hasActiveTopicId], ['title must be a non-empty string when provided', !hasTitle || nonEmpty(value.title)], [`title must be at most ${ConversationTitleMaxLength} characters`, !hasTitle || (typeof value.title === 'string' && value.title.length <= ConversationTitleMaxLength)], ['systemPrompt must be a string when provided', !hasSystemPrompt || typeof value.systemPrompt === 'string'], [`systemPrompt must be at most ${ConversationSystemPromptMaxLength} characters`, !hasSystemPrompt || typeof value.systemPrompt !== 'string' || value.systemPrompt.length <= ConversationSystemPromptMaxLength], ['activeTopicId must be a string or null when provided', !hasActiveTopicId || nullableString(value.activeTopicId)]]); }
export function validateCreateBranchRequest(value: unknown): ValidationResult<CreateBranchRequest> { return !record(value) ? { success: false, errors: ['request must be an object'] } : result(value, [['parentNodeId must be a non-empty string', nonEmpty(value.parentNodeId)]]); }
export function validateCreateTopicRequest(value: unknown): ValidationResult<CreateTopicRequest> { return !record(value) ? { success: false, errors: ['request must be an object'] } : result(value, [['title must be a non-empty string', nonEmpty(value.title)], [`title must be at most ${ConversationTitleMaxLength} characters`, typeof value.title === 'string' && value.title.length <= ConversationTitleMaxLength], ['description must be a string when provided', optionalString(value.description)], ['parentTopicId must be a string or null when provided', value.parentTopicId === undefined || nullableString(value.parentTopicId)]]); }
export function validateUpdateTopicRequest(value: unknown): ValidationResult<UpdateTopicRequest> { if (!record(value)) return { success: false, errors: ['request must be an object'] }; const hasTitle = value.title !== undefined; const hasDescription = value.description !== undefined; return result(value, [['request must include title or description', hasTitle || hasDescription], ['title must be a non-empty string when provided', !hasTitle || nonEmpty(value.title)], [`title must be at most ${ConversationTitleMaxLength} characters`, !hasTitle || (typeof value.title === 'string' && value.title.length <= ConversationTitleMaxLength)], ['description must be a string or null when provided', !hasDescription || nullableString(value.description)]]); }
export function validateMoveTopicRequest(value: unknown): ValidationResult<{ parentTopicId: string | null }> { return !record(value) ? { success: false, errors: ['request must be an object'] } : result(value, [['parentTopicId must be a string or null', nullableString(value.parentTopicId)]]); }
export function validateContextRequest(value: unknown): ValidationResult<{ contextEnabled: boolean }> { return !record(value) ? { success: false, errors: ['request must be an object'] } : result(value, [['contextEnabled must be a boolean', typeof value.contextEnabled === 'boolean']]); }
export function validatePinRequest(value: unknown): ValidationResult<SetNodePinRequest> { return !record(value) ? { success: false, errors: ['request must be an object'] } : result(value, [['pinned must be a boolean', typeof value.pinned === 'boolean']]); }
export function validateStartGenerationRequest(value: unknown): ValidationResult<StartGenerationRequest> { return !record(value) ? { success: false, errors: ['request must be an object'] } : result(value, [['conversationId must be a non-empty string', nonEmpty(value.conversationId)], ['parentNodeId must be a string or null', nullableString(value.parentNodeId)], ['content must be a non-empty string', nonEmpty(value.content)]]); }
