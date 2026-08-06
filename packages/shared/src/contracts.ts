export const NodeRole = {
  System: 'system',
  User: 'user',
  Assistant: 'assistant',
} as const;
export type NodeRole = (typeof NodeRole)[keyof typeof NodeRole];

export const NodeStatus = {
  Pending: 'pending',
  Streaming: 'streaming',
  Completed: 'completed',
  Error: 'error',
} as const;
export type NodeStatus = (typeof NodeStatus)[keyof typeof NodeStatus];

export const WebSocketEvent = {
  ConversationJoin: 'conversation.join',
  ConversationLeave: 'conversation.leave',
  NodeCreated: 'node.created',
  AssistantDelta: 'assistant.delta',
  AssistantCompleted: 'assistant.completed',
  AssistantFailed: 'assistant.failed',
  SubtreePruned: 'subtree.pruned',
} as const;
export type WebSocketEvent = (typeof WebSocketEvent)[keyof typeof WebSocketEvent];

export interface Conversation {
  id: string;
  title: string;
  systemPrompt: string;
  activeTopicId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationNode {
  id: string;
  conversationId: string;
  topicId: string;
  parentId: string | null;
  role: NodeRole;
  content: string;
  status: NodeStatus;
  tokenCount: number | null;
  contextEnabled: boolean;
  errorMessage: string | null;
  prunedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TopicDto {
  id: string; conversationId: string; parentTopicId: string | null; title: string; description: string | null;
  activeNodeId: string | null; contextEnabled: boolean; archivedAt: string | null; createdAt: string; updatedAt: string;
}
export interface CreateTopicRequest { title: string; description?: string; parentTopicId?: string | null }
export interface UpdateTopicRequest { title?: string; description?: string | null }
export interface SetTopicContextRequest { contextEnabled: boolean }
export interface SetNodeContextRequest { contextEnabled: boolean }

export interface ConversationTreeResponse {
  conversation: Conversation;
  topics: TopicDto[];
  nodes: ConversationNode[];
  activeTopicId: string | null;
}

export interface CreateConversationRequest {
  title: string;
  systemPrompt?: string;
}

export interface CreateBranchRequest {
  parentNodeId: string;
}

export interface StartGenerationRequest {
  conversationId: string;
  parentNodeId: string | null;
  content: string;
}

export interface PruneSubtreeResponse {
  conversationId: string;
  prunedNodeId: string;
  prunedNodeCount: number;
}

export interface BranchComparisonResponse {
  conversationId: string;
  nodeIds: string[];
  branches: ConversationNode[][];
}

type ValidationResult<T> = { success: true; data: T } | { success: false; errors: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export const ConversationTitleMaxLength = 200;
export const ConversationSystemPromptMaxLength = 10_000;
const validate = <T>(value: unknown, checks: Array<[string, boolean]>): ValidationResult<T> => {
  const errors = checks.filter(([, valid]) => !valid).map(([name]) => name);
  return errors.length ? { success: false, errors } : { success: true, data: value as T };
};

export function validateCreateConversationRequest(value: unknown): ValidationResult<CreateConversationRequest> {
  if (!isRecord(value)) return { success: false, errors: ['request must be an object'] };
  return validate<CreateConversationRequest>(value, [
    ['title must be a non-empty string', isNonEmptyString(value.title)],
    [`title must be at most ${ConversationTitleMaxLength} characters`, typeof value.title === 'string' && value.title.length <= ConversationTitleMaxLength],
    ['systemPrompt must be a string when provided', value.systemPrompt === undefined || typeof value.systemPrompt === 'string'],
    [`systemPrompt must be at most ${ConversationSystemPromptMaxLength} characters`, value.systemPrompt === undefined || typeof value.systemPrompt !== 'string' || value.systemPrompt.length <= ConversationSystemPromptMaxLength],
  ]);
}

export function validateUpdateConversationRequest(value: unknown): ValidationResult<Partial<CreateConversationRequest>> {
  if (!isRecord(value)) return { success: false, errors: ['request must be an object'] };
  const hasTitle = value.title !== undefined;
  const hasSystemPrompt = value.systemPrompt !== undefined;
  return validate<Partial<CreateConversationRequest>>(value, [
    ['request must include title or systemPrompt', hasTitle || hasSystemPrompt],
    ['title must be a non-empty string when provided', !hasTitle || isNonEmptyString(value.title)],
    [`title must be at most ${ConversationTitleMaxLength} characters`, !hasTitle || (typeof value.title === 'string' && value.title.length <= ConversationTitleMaxLength)],
    ['systemPrompt must be a string when provided', !hasSystemPrompt || typeof value.systemPrompt === 'string'],
    [`systemPrompt must be at most ${ConversationSystemPromptMaxLength} characters`, !hasSystemPrompt || typeof value.systemPrompt !== 'string' || value.systemPrompt.length <= ConversationSystemPromptMaxLength],
  ]);
}

export function validateCreateBranchRequest(value: unknown): ValidationResult<CreateBranchRequest> {
  if (!isRecord(value)) return { success: false, errors: ['request must be an object'] };
  return validate<CreateBranchRequest>(value, [['parentNodeId must be a non-empty string', isNonEmptyString(value.parentNodeId)]]);
}

export function validateCreateTopicRequest(value: unknown): ValidationResult<CreateTopicRequest> {
  if (!isRecord(value)) return { success: false, errors: ['request must be an object'] };
  return validate<CreateTopicRequest>(value, [
    ['title must be a non-empty string', isNonEmptyString(value.title)],
    [`title must be at most ${ConversationTitleMaxLength} characters`, typeof value.title === 'string' && value.title.length <= ConversationTitleMaxLength],
    ['description must be a string when provided', value.description === undefined || typeof value.description === 'string'],
    ['parentTopicId must be a string or null when provided', value.parentTopicId === undefined || value.parentTopicId === null || isNonEmptyString(value.parentTopicId)],
  ]);
}

export function validateContextRequest(value: unknown): ValidationResult<{ contextEnabled: boolean }> {
  if (!isRecord(value)) return { success: false, errors: ['request must be an object'] };
  return validate<{ contextEnabled: boolean }>(value, [['contextEnabled must be a boolean', typeof value.contextEnabled === 'boolean']]);
}

export function validateStartGenerationRequest(value: unknown): ValidationResult<StartGenerationRequest> {
  if (!isRecord(value)) return { success: false, errors: ['request must be an object'] };
  return validate<StartGenerationRequest>(value, [
    ['conversationId must be a non-empty string', isNonEmptyString(value.conversationId)],
    ['parentNodeId must be a string or null', value.parentNodeId === null || isNonEmptyString(value.parentNodeId)],
    ['content must be a non-empty string', isNonEmptyString(value.content)],
  ]);
}
