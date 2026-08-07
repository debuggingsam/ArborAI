import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiProvider, AiStructuredOutputInput } from './ai-provider.js';
import { ContextCapsuleService, type CapsuleTopicRecord, type ContextCapsuleStore } from './context-capsule.service.js';
import { MockAiProvider } from './mock-ai-provider.js';

const root = (overrides: Partial<CapsuleTopicRecord> = {}): CapsuleTopicRecord => ({
  id: 'root', conversationId: 'workspace', parentTopicId: null, title: 'Authentication', description: 'Access control',
  contextCapsule: null, capsuleVersion: 0, ...overrides,
});
const child = (overrides: Partial<CapsuleTopicRecord> = {}): CapsuleTopicRecord => ({
  id: 'child', conversationId: 'workspace', parentTopicId: 'root', title: 'Refresh tokens', description: null,
  contextCapsule: null, capsuleVersion: 0, ...overrides,
});
const capsule = (overrides: Record<string, unknown> = {}) => ({
  summary: 'Authentication uses short-lived access tokens.', facts: ['Frontend is Next.js'], decisions: [], constraints: [], openQuestions: ['Should rotation happen on every use?'], sourceTopicIds: [], sourceNodeIds: [], ...overrides,
});

class Store implements ContextCapsuleStore {
  saved: Array<{ topicId: string; capsule: unknown }> = [];
  constructor(readonly topics: CapsuleTopicRecord[]) {}
  async findTopic(id: string) { return this.topics.find((topic) => topic.id === id) ?? null; }
  async listTopics(workspaceId: string) { return this.topics.filter((topic) => topic.conversationId === workspaceId); }
  async saveCapsule(topicId: string, value: CapsuleTopicRecord['contextCapsule']) {
    this.saved.push({ topicId, capsule: value });
    const topic = this.topics.find((item) => item.id === topicId)!;
    topic.contextCapsule = value;
    topic.capsuleVersion += 1;
  }
}

class Provider implements AiProvider {
  readonly name = 'mock' as const;
  calls: AiStructuredOutputInput<unknown>[] = [];
  constructor(private readonly output: unknown | (() => unknown)) {}
  async *streamAnswer() { yield { type: 'completed' } as const; }
  async createStructuredOutput<T>(input: AiStructuredOutputInput<T>): Promise<T> {
    this.calls.push(input);
    return (typeof this.output === 'function' ? this.output() : this.output) as T;
  }
}

test('creates a bounded root capsule with the new topic and node as authoritative sources', async () => {
  const store = new Store([root()]);
  const provider = new Provider(capsule({ facts: ['One', ' one ', 'Two'] }));
  const result = await new ContextCapsuleService(store, provider, 'capsule-model').createRoot({ topicId: 'root', workspaceInstructions: 'Use plain language.', userPrompt: 'How should auth work?', sourceNodeId: 'user-1' });
  assert.equal(result.status, 'updated');
  if (result.status !== 'updated') return;
  assert.deepEqual(result.capsule.facts, ['One', 'Two']);
  assert.deepEqual(result.capsule.sourceTopicIds, ['root']);
  assert.deepEqual(result.capsule.sourceNodeIds, ['user-1']);
  assert.equal(store.saved.length, 1);
  assert.match(String(provider.calls[0].systemPrompt), /compact context capsule/);
});

test('uses the deterministic mock provider through the same capsule service interface', async () => {
  const store = new Store([root()]);
  const result = await new ContextCapsuleService(store, new MockAiProvider(), 'mock-capsule').createRoot({ topicId: 'root', workspaceInstructions: '', userPrompt: 'How should auth work?', sourceNodeId: 'user-1' });
  assert.equal(result.status, 'updated');
  if (result.status !== 'updated') return;
  assert.equal(result.capsule.summary, 'Mock capsule update.');
  assert.deepEqual(result.capsule.sourceTopicIds, ['root']);
  assert.deepEqual(result.capsule.sourceNodeIds, ['user-1']);
});

test('creates a child capsule using compact parent knowledge without copying message transcripts', async () => {
  const parentCapsule = capsule({ sourceTopicIds: ['root'], sourceNodeIds: ['parent-user'] });
  const store = new Store([root({ contextCapsule: parentCapsule }), child()]);
  const provider = new Provider(capsule({ summary: 'Refresh-token rules inherit the authentication decisions.' }));
  const result = await new ContextCapsuleService(store, provider, 'capsule-model').createChild({ topicId: 'child', userPrompt: 'What about refresh tokens?', sourceNodeId: 'child-user' });
  assert.equal(result.status, 'updated');
  if (result.status !== 'updated') return;
  assert.deepEqual(result.capsule.sourceTopicIds, ['root', 'child']);
  assert.deepEqual(result.capsule.sourceNodeIds, ['parent-user', 'child-user']);
  const payload = provider.calls[0].payload as Record<string, unknown>;
  assert.deepEqual(payload.inheritedCapsule, [parentCapsule]);
  assert.equal(JSON.stringify(payload).includes('full raw ancestor transcript'), false);
});

test('updates a capsule after a successful response and removes a resolved open question', async () => {
  const previous = capsule({ sourceTopicIds: ['root'], sourceNodeIds: ['old-node'] });
  const store = new Store([root({ contextCapsule: previous, capsuleVersion: 2 })]);
  const provider = new Provider(capsule({ facts: ['The API is written in TypeScript'], decisions: ['Refresh tokens rotate on every use.'], openQuestions: [], sourceTopicIds: ['untrusted'], sourceNodeIds: ['untrusted'] }));
  const result = await new ContextCapsuleService(store, provider, 'capsule-model').updateAfterSuccessfulResponse({ topicId: 'root', userPrompt: 'Should rotation happen on every use?', assistantResponse: 'Yes, rotate refresh tokens on every use.', userNodeId: 'user-2', assistantNodeId: 'assistant-2' });
  assert.equal(result.status, 'updated');
  if (result.status !== 'updated') return;
  assert.deepEqual(result.capsule.facts, ['Frontend is Next.js', 'The API is written in TypeScript']);
  assert.deepEqual(result.capsule.openQuestions, []);
  assert.deepEqual(result.capsule.sourceTopicIds, ['root']);
  assert.deepEqual(result.capsule.sourceNodeIds, ['old-node', 'user-2', 'assistant-2']);
});

test('rejects malformed model output and preserves the old capsule', async () => {
  const previous = capsule({ sourceTopicIds: ['root'], sourceNodeIds: ['old-node'] });
  const store = new Store([root({ contextCapsule: previous })]);
  const provider = new Provider({ malformed: true });
  const warnings: string[] = [];
  const service = new ContextCapsuleService(store, provider, 'capsule-model', { warn: (message) => warnings.push(message) });
  const result = await service.updateAfterSuccessfulResponse({ topicId: 'root', userPrompt: 'Question', assistantResponse: 'Answer', userNodeId: 'user-2', assistantNodeId: 'assistant-2' });
  assert.equal(result.status, 'failed');
  assert.deepEqual(store.topics[0].contextCapsule, previous);
  assert.equal(store.saved.length, 0);
  assert.match(warnings[0], /Capsule update failed/);
});

test('manual retry can update a capsule after a prior provider failure', async () => {
  const previous = capsule({ sourceTopicIds: ['root'], sourceNodeIds: ['old-node'] });
  const store = new Store([root({ contextCapsule: previous })]);
  let attempts = 0;
  const provider = new Provider(() => {
    attempts += 1;
    if (attempts === 1) throw new Error('provider unavailable');
    return capsule({ openQuestions: [] });
  });
  const service = new ContextCapsuleService(store, provider, 'capsule-model', { warn() {} });
  const input = { topicId: 'root', userPrompt: 'Question', assistantResponse: 'Answer', userNodeId: 'user-2', assistantNodeId: 'assistant-2' };
  assert.equal((await service.updateAfterSuccessfulResponse(input)).status, 'failed');
  assert.equal((await service.retryUpdate(input)).status, 'updated');
  assert.equal(store.saved.length, 1);
});
