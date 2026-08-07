import OpenAI from 'openai';
import type { ModelMessage } from '@arborai/shared';
import { AiProviderError, parseStructuredOutput, type AiProvider, type AiStreamEvent, type AiStructuredOutputInput } from './ai-provider.js';

/** OpenAI Responses adapter. OpenAI SDK types stay in this module. */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai' as const;
  private readonly client: OpenAI;

  constructor(apiKey: string, client = new OpenAI({ apiKey })) { this.client = client; }

  async *streamAnswer(input: { model: string; messages: ModelMessage[]; generationId: string; signal?: AbortSignal }): AsyncIterable<AiStreamEvent> {
    try {
      const stream = await this.client.responses.create({ model: input.model, input: input.messages.map((message) => ({ role: message.role, content: message.content })), stream: true }, { signal: input.signal });
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') yield { type: 'text_delta', delta: event.delta };
        if (event.type === 'response.completed') {
          yield { type: 'usage', inputTokens: event.response.usage?.input_tokens ?? null, outputTokens: event.response.usage?.output_tokens ?? null };
          yield { type: 'completed' };
        }
      }
    } catch (error) { throw normalizeOpenAiError(error); }
  }

  async createStructuredOutput<T>(input: AiStructuredOutputInput<T>): Promise<T> {
    try {
      const response = await this.client.responses.create({
        model: input.model, instructions: input.systemPrompt, input: JSON.stringify(input.payload),
        text: { format: { type: 'json_schema', name: input.schemaName, schema: input.jsonSchema } },
      }, { signal: input.signal });
      let output: unknown;
      try { output = JSON.parse(response.output_text); } catch { throw new AiProviderError('malformed_output', 'OpenAI returned structured output that was not valid JSON.'); }
      return parseStructuredOutput(output, input.schema);
    } catch (error) { throw error instanceof AiProviderError ? error : normalizeOpenAiError(error); }
  }
}

function normalizeOpenAiError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (error instanceof Error && error.name === 'AbortError') return new AiProviderError('interrupted', 'OpenAI request was aborted.', error);
  const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: number }).status : undefined;
  if (status === 401 || status === 403) return new AiProviderError('authentication', 'OpenAI authentication failed.', error);
  if (status === 429) return new AiProviderError('rate_limited', 'OpenAI rate limit exceeded.', error);
  if (status && status >= 400 && status < 500) return new AiProviderError('invalid_request', 'OpenAI rejected the request.', error);
  if (status && status >= 500) return new AiProviderError('unavailable', 'OpenAI is temporarily unavailable.', error);
  return new AiProviderError('unknown', 'OpenAI request failed.', error);
}
