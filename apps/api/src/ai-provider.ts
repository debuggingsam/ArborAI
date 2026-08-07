import type { ModelMessage, RuntimeSchema } from '@arborai/shared';

export type AiStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'usage'; inputTokens: number | null; outputTokens: number | null }
  | { type: 'completed' };

export type JsonSchema = Record<string, unknown>;
export type AiStructuredOutputInput<T> = { model: string; systemPrompt: string; payload: unknown; schema: RuntimeSchema<T>; schemaName: string; jsonSchema: JsonSchema; signal?: AbortSignal };

export interface AiProvider {
  readonly name: 'mock' | 'openai';
  streamAnswer(input: { model: string; messages: ModelMessage[]; generationId: string; signal?: AbortSignal }): AsyncIterable<AiStreamEvent>;
  createStructuredOutput<T>(input: AiStructuredOutputInput<T>): Promise<T>;
}

export class AiProviderError extends Error {
  constructor(
    public readonly code: 'authentication' | 'rate_limited' | 'invalid_request' | 'unavailable' | 'malformed_output' | 'interrupted' | 'unknown',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export function parseStructuredOutput<T>(value: unknown, schema: RuntimeSchema<T>): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AiProviderError('malformed_output', `Provider returned malformed structured output: ${parsed.errors.join('; ')}`);
  return parsed.data;
}
