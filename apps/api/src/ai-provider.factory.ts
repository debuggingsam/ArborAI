import type { ApiConfig } from './config.js';
import type { AiProvider } from './ai-provider.js';
import { MockAiProvider } from './mock-ai-provider.js';
import { OpenAiProvider } from './openai-ai-provider.js';

export function createAiProvider(config: ApiConfig): AiProvider {
  if (config.aiProvider === 'mock') return new MockAiProvider({ delayMs: config.mockStreamDelayMs ?? 40, forceFailure: config.mockForceFailure ?? false, forceMalformedStructuredOutput: config.mockMalformedStructuredOutput ?? false, interruptStream: config.mockInterruptStream ?? false });
  if (config.aiProvider === 'openai') return new OpenAiProvider(config.openAiApiKey!);
  throw new Error(`Unsupported AI_PROVIDER “${config.aiProvider}”.`);
}
