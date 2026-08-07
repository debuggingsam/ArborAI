import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadLocalEnv(): void {
  try {
    for (const line of readFileSync(resolve(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* .env is optional when variables are supplied by the environment. */ }
}

export type ApiConfig = {
  port: number; webOrigin: string; aiProvider: string; wsPath: string;
  openAiApiKey?: string; answerModel?: string; treeMakerModel?: string; capsuleModel?: string;
  treeMakerHighConfidence?: number; treeMakerLowConfidence?: number; maxInputTokens?: number | null;
  mockStreamDelayMs?: number; mockForceFailure?: boolean; mockMalformedStructuredOutput?: boolean; mockInterruptStream?: boolean;
};

export function getConfig(env = process.env): ApiConfig {
  loadLocalEnv();
  const required = ['API_PORT', 'WEB_ORIGIN', 'AI_PROVIDER'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}. Copy .env.example to .env or export them.`);
  const port = Number(env.API_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be an integer between 1 and 65535.');
  if (env.AI_PROVIDER !== 'mock' && env.AI_PROVIDER !== 'openai') throw new Error(`Unsupported AI_PROVIDER “${env.AI_PROVIDER}”; use “mock” or “openai”.`);
  const number = (key: string, fallback: number, minimum = 0) => {
    const value = env[key] === undefined || env[key] === '' ? fallback : Number(env[key]);
    if (!Number.isFinite(value) || value < minimum) throw new Error(`${key} must be a number greater than or equal to ${minimum}.`);
    return value;
  };
  const integer = (key: string, fallback: number, minimum = 0) => {
    const value = number(key, fallback, minimum);
    if (!Number.isInteger(value)) throw new Error(`${key} must be an integer.`);
    return value;
  };
  const treeMakerHighConfidence = number('TREE_MAKER_HIGH_CONFIDENCE', 0.85);
  const treeMakerLowConfidence = number('TREE_MAKER_LOW_CONFIDENCE', 0.55);
  if (treeMakerHighConfidence > 1 || treeMakerLowConfidence > 1 || treeMakerLowConfidence > treeMakerHighConfidence) throw new Error('TreeMaker confidence thresholds must be between 0 and 1, with LOW not greater than HIGH.');
  const maxInputTokens = env.MAX_INPUT_TOKENS === undefined || env.MAX_INPUT_TOKENS === '' ? null : integer('MAX_INPUT_TOKENS', 1, 1);
  const answerModel = env.ANSWER_MODEL || (env.AI_PROVIDER === 'mock' ? 'mock-answer' : '');
  const treeMakerModel = env.TREE_MAKER_MODEL || (env.AI_PROVIDER === 'mock' ? 'mock-tree-maker' : '');
  const capsuleModel = env.CAPSULE_MODEL || (env.AI_PROVIDER === 'mock' ? 'mock-capsule' : '');
  if (env.AI_PROVIDER === 'openai') {
    const missingReal = [!env.OPENAI_API_KEY && 'OPENAI_API_KEY', !answerModel && 'ANSWER_MODEL', !treeMakerModel && 'TREE_MAKER_MODEL', !capsuleModel && 'CAPSULE_MODEL'].filter(Boolean);
    if (missingReal.length) throw new Error(`AI_PROVIDER=openai requires: ${missingReal.join(', ')}.`);
  }
  return { port, webOrigin: env.WEB_ORIGIN!, aiProvider: env.AI_PROVIDER, wsPath: env.WS_PATH || '/ws', openAiApiKey: env.OPENAI_API_KEY, answerModel, treeMakerModel, capsuleModel, treeMakerHighConfidence, treeMakerLowConfidence, maxInputTokens, mockStreamDelayMs: integer('MOCK_STREAM_DELAY_MS', 40), mockForceFailure: env.MOCK_FORCE_FAILURE === 'true', mockMalformedStructuredOutput: env.MOCK_MALFORMED_STRUCTURED_OUTPUT === 'true', mockInterruptStream: env.MOCK_INTERRUPT_STREAM === 'true' };
}
