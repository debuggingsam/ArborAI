import assert from 'node:assert/strict';
import test from 'node:test';
import { TopicContextCapsuleSchema, TreeMakerDecisionSchema, type TreeMakerInput } from '@arborai/shared';
import { createAiProvider } from '../ai-provider.factory.js';
import { AiProviderError, type AiProvider, type AiStructuredOutputInput } from '../ai-provider.js';
import { getConfig } from '../config.js';
import { MockAiProvider } from '../mock-ai-provider.js';
import { OpenAiProvider } from '../openai-ai-provider.js';
import { ProviderTreeMaker } from '../tree-maker.service.js';

const env = (extra: Record<string, string> = {}) => ({ API_PORT: '3001', WEB_ORIGIN: 'http://localhost:5173', AI_PROVIDER: 'mock', ...extra });

test('selects mock and OpenAI providers from validated configuration', () => {
  assert.ok(createAiProvider(getConfig(env())) instanceof MockAiProvider);
  assert.ok(createAiProvider(getConfig(env({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key', ANSWER_MODEL: 'gpt-test', TREE_MAKER_MODEL: 'gpt-test', CAPSULE_MODEL: 'gpt-test' }))) instanceof OpenAiProvider);
});

test('mock provider streams deterministic chunks and usage', async () => {
  const provider = new MockAiProvider({ answerText: 'A deterministic answer' });
  const events = [] as unknown[];
  for await (const event of provider.streamAnswer({ model: 'mock-answer', messages: [{ role: 'user', content: 'Prompt' }], generationId: 'generation' })) events.push(event);
  assert.deepEqual(events, [
    { type: 'text_delta', delta: 'A ' }, { type: 'text_delta', delta: 'deterministic ' }, { type: 'text_delta', delta: 'answer' },
    { type: 'usage', inputTokens: 2, outputTokens: 6 }, { type: 'completed' },
  ]);
});

test('mock provider produces validated deterministic TreeMaker structured output', async () => {
  const output = await new MockAiProvider().createStructuredOutput({ model: 'mock-tree-maker', systemPrompt: 'route', payload: input(), schema: TreeMakerDecisionSchema, schemaName: 'tree_maker_decision', jsonSchema: {} });
  assert.deepEqual(output, { action: 'continue_topic', topicId: 'topic', anchorNodeId: 'node', confidence: 0.9, reasoning: 'The active topic is a valid default for an ordinary follow-up.' });
});

test('mock provider produces validated deterministic capsule structured output', async () => {
  const capsule = await new MockAiProvider().createStructuredOutput({ model: 'mock-capsule', systemPrompt: 'summarize', payload: { sourceNodeIds: ['node'] }, schema: TopicContextCapsuleSchema, schemaName: 'topic_capsule', jsonSchema: {} });
  assert.deepEqual(capsule, { summary: 'Mock capsule update.', facts: [], decisions: [], constraints: [], openQuestions: [], sourceTopicIds: [], sourceNodeIds: ['node'] });
});

test('mock provider reports forced failures and malformed structured output', async () => {
  await assert.rejects(() => new MockAiProvider({ forceFailure: true }).createStructuredOutput({ model: 'mock', systemPrompt: '', payload: input(), schema: TreeMakerDecisionSchema, schemaName: 'tree_maker_decision', jsonSchema: {} }), (error: unknown) => error instanceof AiProviderError && error.code === 'unavailable');
  await assert.rejects(() => new MockAiProvider({ forceMalformedStructuredOutput: true }).createStructuredOutput({ model: 'mock', systemPrompt: '', payload: input(), schema: TreeMakerDecisionSchema, schemaName: 'tree_maker_decision', jsonSchema: {} }), (error: unknown) => error instanceof AiProviderError && error.code === 'malformed_output');
});

test('real provider mode fails fast when credentials or models are missing', () => {
  assert.throws(() => getConfig(env({ AI_PROVIDER: 'openai' })), /OPENAI_API_KEY, ANSWER_MODEL, TREE_MAKER_MODEL, CAPSULE_MODEL/);
});

test('TreeMaker requests structured output through the provider abstraction', async () => {
  const calls: unknown[] = [];
  const provider: AiProvider = {
    name: 'mock',
    async *streamAnswer() { yield { type: 'completed' } as const; },
    async createStructuredOutput<T>(request: AiStructuredOutputInput<T>) { calls.push(request); return request.schema.parse({ action: 'continue_topic', topicId: 'topic', anchorNodeId: null, confidence: 0.9, reasoning: 'test' }); },
  };
  await new ProviderTreeMaker(provider, 'tree-model').decide(input());
  assert.equal((calls[0] as { model: string }).model, 'tree-model');
  assert.match((calls[0] as { systemPrompt: string }).systemPrompt, /topic-routing agent/);
});

function input(): TreeMakerInput {
  return { workspace: { id: 'workspace', title: 'Workspace' }, activeTopicId: 'topic', activeNodeId: 'node', topics: [{ id: 'topic', parentTopicId: null, title: 'Topic', description: null, capsuleSummary: null, recentActivity: null, contextEnabled: true, archived: false, childTopicCount: 0, messageCount: 0 }], recentMessagesByTopic: {}, newPrompt: 'Follow up' };
}
