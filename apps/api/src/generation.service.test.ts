import test from 'node:test';
import assert from 'node:assert/strict';
import { MockAiProvider } from './mock-ai-provider.js';
import { GenerationApplicationService, type GenerationNode, type GenerationStore, type GenerationTopic, type GenerationWorkspace } from './generation.service.js';

const workspace: GenerationWorkspace = { id: 'workspace', title: 'Workspace', systemPrompt: null, activeTopicId: 'topic' };
const topic: GenerationTopic = { id: 'topic', conversationId: 'workspace', parentTopicId: null, title: 'Existing', description: null, contextEnabled: true, archivedAt: null, contextCapsule: null };
const user = (id = 'user'): GenerationNode => ({ id, conversationId: 'workspace', topicId: 'topic', parentId: null, role: 'user', content: 'Original prompt', contextEnabled: true, pinned: false, prunedAt: null, createdAt: new Date(), status: 'completed', errorMessage: null });

class MemoryStore implements GenerationStore {
  topics = [topic]; nodes = [user()]; initialized: Array<{ request: unknown; placement: unknown; context: unknown }> = []; deltas = ''; completed = false; failed = false;
  async findWorkspace() { return workspace; } async listTopics() { return this.topics; } async listNodes() { return this.nodes; }
  async initialize(_workspaceId: string, request: any, placement: any, context: any) { this.initialized.push({ request, placement, context }); const userNodeId = request.mode === 'regenerate' ? request.userNodeId : `user-${this.initialized.length}`; const assistantNodeId = `assistant-${this.initialized.length}`; return { generationId: `generation-${this.initialized.length}`, topicId: placement.topicId, userNodeId, assistantNodeId, context, createdTopicId: placement.createTopic ? placement.topicId : null }; }
  async markStreaming() {} async appendDelta(_id: string, delta: string) { this.deltas += delta; } async complete() { this.completed = true; } async fail() { this.failed = true; }
}
function treeMaker(decision: any) { return { preview: async () => ({ decision, requiresConfirmation: decision.action === 'ask_user' }) } as any; }
function service(store: MemoryStore, decision: any = { action: 'continue_topic', topicId: 'topic', anchorNodeId: null, confidence: 0.9, reasoning: 'test' }) { return new GenerationApplicationService(store, new MockAiProvider(), 'mock-answer', treeMaker(decision)); }

test('manual continue creates a user/assistant pair and immutable snapshot', async () => {
  const store = new MemoryStore(); const result = await service(store).start('workspace', { mode: 'manual_continue', prompt: 'Follow up', topicId: 'topic', anchorNodeId: 'user' });
  assert.equal(result.status, 'accepted'); assert.equal((store.initialized[0]!.placement as any).anchorNodeId, 'user'); assert.equal((store.initialized[0]!.context as any).messages.at(-1).content, 'Follow up');
});
test('manual subtopic and root topic create distinct topic placements', async () => {
  const sub = new MemoryStore(); await service(sub).start('workspace', { mode: 'manual_subtopic', prompt: 'Sub prompt', parentTopicId: 'topic' });
  assert.equal((sub.initialized[0]!.placement as any).createTopic.parentTopicId, 'topic');
  const root = new MemoryStore(); await service(root).start('workspace', { mode: 'manual_root_topic', prompt: 'Root prompt' });
  assert.equal((root.initialized[0]!.placement as any).createTopic.parentTopicId, null);
});
test('regeneration reuses the user node and creates no duplicate user node', async () => {
  const store = new MemoryStore(); const result = await service(store).start('workspace', { mode: 'regenerate', userNodeId: 'user' });
  assert.equal(result.userNodeId, 'user'); assert.equal((store.initialized[0]!.request as any).mode, 'regenerate');
});
test('auto route honors continuation, new-topic placement, and clarification without graph mutation', async () => {
  const continued = new MemoryStore(); await service(continued).start('workspace', { mode: 'auto_route', prompt: 'Continue', activeTopicId: 'topic', activeNodeId: null }); assert.equal(continued.initialized.length, 1);
  const created = new MemoryStore(); await service(created, { action: 'create_root_topic', title: 'New', description: null, provisionalCapsule: null, confidence: 0.9, reasoning: 'test' }).start('workspace', { mode: 'auto_route', prompt: 'New', activeTopicId: null, activeNodeId: null }); assert.ok((created.initialized[0]!.placement as any).createTopic);
  const clarification = new MemoryStore(); const response = await service(clarification, { action: 'ask_user', question: 'Which?', suggestedTopicIds: ['topic'], confidence: 0.2, reasoning: 'test' }).start('workspace', { mode: 'auto_route', prompt: 'Ambiguous', activeTopicId: 'topic', activeNodeId: null }); assert.equal(response.status, 'clarification_required'); assert.equal(clarification.initialized.length, 0);
});
test('failed initialization never invokes the provider', async () => {
  const store = new MemoryStore(); store.initialize = async () => { throw new Error('transaction failed'); };
  let calls = 0;
  const provider = { name: 'mock' as const, async *streamAnswer() { calls += 1; }, async createStructuredOutput() { throw new Error('unused'); } };
  const app = new GenerationApplicationService(store, provider, 'mock-answer', treeMaker({ action: 'continue_topic', topicId: 'topic', anchorNodeId: null, confidence: 0.9, reasoning: 'test' }));
  await assert.rejects(app.start('workspace', { mode: 'manual_continue', prompt: 'Follow up', topicId: 'topic', anchorNodeId: null }));
  assert.equal(calls, 0);
});
test('mock provider streams persisted deltas through completed state', async () => {
  const store = new MemoryStore(); const events: string[] = [];
  const app = new GenerationApplicationService(store, new MockAiProvider({ answerText: 'streamed answer' }), 'mock-answer', treeMaker({ action: 'continue_topic', topicId: 'topic', anchorNodeId: null, confidence: 0.9, reasoning: 'test' }), undefined, null, { publish(event) { events.push(event.type); } });
  await app.start('workspace', { mode: 'manual_continue', prompt: 'Follow up', topicId: 'topic', anchorNodeId: null });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(store.completed, true); assert.equal(store.deltas, 'streamed answer'); assert.ok(events.includes('assistant.delta')); assert.ok(events.includes('assistant.completed'));
});
