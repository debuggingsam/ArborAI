import { TopicContextCapsuleSchema, TreeMakerDecisionSchema, type ModelMessage, type TreeMakerDecision, type TreeMakerInput } from '@arborai/shared';
import { AiProviderError, parseStructuredOutput, type AiProvider, type AiStreamEvent, type AiStructuredOutputInput } from './ai-provider.js';

export type MockAiProviderOptions = {
  delayMs?: number;
  forceFailure?: boolean;
  forceMalformedStructuredOutput?: boolean;
  interruptStream?: boolean;
  structuredOutput?: unknown;
  answerText?: string;
};

/** Offline deterministic provider used by tests, demos, and local development. */
export class MockAiProvider implements AiProvider {
  readonly name = 'mock' as const;
  constructor(private readonly options: MockAiProviderOptions = {}) {}

  async *streamAnswer(input: { model: string; messages: ModelMessage[]; generationId: string; signal?: AbortSignal }): AsyncIterable<AiStreamEvent> {
    this.throwIfFailed();
    const answer = this.options.answerText ?? `Mock answer: ${input.messages.at(-1)?.content ?? ''}`;
    for (const delta of chunk(answer)) {
      if (input.signal?.aborted) throw new AiProviderError('interrupted', 'Answer stream was aborted.');
      if (this.options.interruptStream) throw new AiProviderError('interrupted', 'Mock answer stream was interrupted.');
      await wait(this.options.delayMs ?? 0);
      yield { type: 'text_delta', delta };
    }
    yield { type: 'usage', inputTokens: estimateTokens(input.messages.map((message) => message.content).join('\n')), outputTokens: estimateTokens(answer) };
    yield { type: 'completed' };
  }

  async createStructuredOutput<T>(input: AiStructuredOutputInput<T>): Promise<T> {
    this.throwIfFailed();
    if (input.signal?.aborted) throw new AiProviderError('interrupted', 'Structured output request was aborted.');
    await wait(this.options.delayMs ?? 0);
    const output = this.options.structuredOutput ?? (isTreeMakerInput(input.payload) ? decideTreeMaker(input.payload) : deterministicCapsule(input.payload));
    return parseStructuredOutput(this.options.forceMalformedStructuredOutput ? { malformed: true } : output, input.schema);
  }

  private throwIfFailed() {
    if (this.options.forceFailure) throw new AiProviderError('unavailable', 'Mock provider failure was requested.');
  }
}

function isTreeMakerInput(value: unknown): value is TreeMakerInput {
  return typeof value === 'object' && value !== null && 'newPrompt' in value && 'topics' in value;
}

function decideTreeMaker(input: TreeMakerInput): TreeMakerDecision {
  const prompt = input.newPrompt.trim();
  const lower = prompt.toLowerCase();
  if (lower.startsWith('ask:') || /\b(ambiguous|not sure which topic)\b/.test(lower)) return { action: 'ask_user', question: 'Which existing topic should this belong to?', suggestedTopicIds: input.topics.slice(0, 3).map((topic) => topic.id), confidence: 0.4, reasoning: 'The prompt explicitly indicates ambiguous placement.' };
  if (lower.startsWith('subtopic:') && input.activeTopicId) return { action: 'create_subtopic', parentTopicId: input.activeTopicId, title: deriveTitle(prompt.slice('subtopic:'.length)), description: null, provisionalCapsule: null, confidence: 0.7, reasoning: 'The prompt explicitly requests a related subtopic.' };
  if (lower.startsWith('root:') || lower.startsWith('new topic:')) return { action: 'create_root_topic', title: deriveTitle(prompt), description: null, provisionalCapsule: null, confidence: 0.9, reasoning: 'The prompt explicitly requests an independent topic.' };
  if (input.activeTopicId) return { action: 'continue_topic', topicId: input.activeTopicId, anchorNodeId: input.activeNodeId, confidence: 0.9, reasoning: 'The active topic is a valid default for an ordinary follow-up.' };
  return { action: 'create_root_topic', title: deriveTitle(prompt), description: null, provisionalCapsule: null, confidence: 0.9, reasoning: 'There is no valid active topic to continue.' };
}

function deterministicCapsule(payload: unknown) {
  const sourceNodeIds = typeof payload === 'object' && payload !== null && Array.isArray((payload as { sourceNodeIds?: unknown }).sourceNodeIds) ? (payload as { sourceNodeIds: string[] }).sourceNodeIds : [];
  return TopicContextCapsuleSchema.parse({ summary: 'Mock capsule update.', facts: [], decisions: [], constraints: [], openQuestions: [], sourceTopicIds: [], sourceNodeIds });
}

function deriveTitle(value: string) { const title = value.trim().replace(/^(subtopic:|root:|new topic:)\s*/i, '').split(/[.?!\n]/, 1)[0].trim() || 'New topic'; return title.slice(0, 200).trim(); }
function chunk(value: string) { return value.match(/\S+\s*/g) ?? []; }
function estimateTokens(value: string) { return Math.ceil(value.length / 4); }
function wait(delayMs: number) { return delayMs > 0 ? new Promise<void>((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve(); }

export const MockTreeMakerDecisionSchema = TreeMakerDecisionSchema;
