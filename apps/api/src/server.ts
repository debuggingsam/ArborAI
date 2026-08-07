import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { getConfig, type ApiConfig } from './config.js';
import { ConversationService, ConversationNotFoundError, TopicValidationError } from './conversations.service.js';
import { validateCreateConversationRequest, validateUpdateConversationRequest, validateCreateTopicRequest, validateUpdateTopicRequest, validateMoveTopicRequest, validateContextRequest, validatePinRequest, ComparisonRequestSchema, ContextPreviewRequestSchema, GenerationRequestSchema, TreeMakerPreviewRequestSchema } from '@arborai/shared';
import { ConversationRepository } from './repositories/conversation.repository.js';
import { PrismaTreeMakerStore } from './tree-maker.repository.js';
import { ProviderTreeMaker, TreeMakerApplicationService, TreeMakerWorkspaceNotFoundError } from './tree-maker.service.js';
import { createAiProvider } from './ai-provider.factory.js';
import { PrismaContextPreviewStore } from './context-preview.repository.js';
import { ContextEngineValidationError, ContextPreviewApplicationService, ContextPreviewWorkspaceNotFoundError } from './context-preview.service.js';
import { GenerationApplicationService, GenerationValidationError, GenerationWorkspaceNotFoundError } from './generation.service.js';
import { PrismaGenerationStore } from './generation.repository.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { ContextCapsuleService } from './context-capsule.service.js';
import { PrismaContextCapsuleStore } from './context-capsule.repository.js';
import { ComparisonApplicationService, ComparisonValidationError, ComparisonWorkspaceNotFoundError } from './comparison.service.js';

type Dependencies = { conversations: ConversationService; treeMaker?: TreeMakerApplicationService; contextPreview?: ContextPreviewApplicationService; generations?: GenerationApplicationService; comparisons?: ComparisonApplicationService };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (response: ServerResponse, status: number, body: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
const errorBody = (code: string, message: string, details?: string[]) => ({ error: { code, message, ...(details ? { details } : {}) } });

async function readBody(request: IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of request) body += chunk;
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw new Error('invalid_json'); }
}

const workspaceGraph = (graph: Awaited<ReturnType<ConversationService['get']>>) => ({
  workspace: graph.conversation,
  topics: graph.topics,
  nodes: graph.nodes,
  activeTopicId: graph.activeTopicId,
});

export async function handleApiRequest(config: ApiConfig, request: IncomingMessage, response: ServerResponse, dependencies?: Dependencies): Promise<void> {
  response.setHeader('Access-Control-Allow-Origin', config.webOrigin);
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (!dependencies) { json(response, 500, errorBody('configuration_error', 'Conversation service is not configured.')); return; }
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const collection = path === '/conversations' || path === '/workspaces';
  const member = path.match(/^\/(conversations|workspaces)\/([^/]+)$/);
  const topicCollection = path.match(/^\/(?:conversations|workspaces)\/([^/]+)\/topics$/);
  const treeMakerPreview = path.match(/^\/workspaces\/([^/]+)\/tree-maker\/preview$/);
  const contextPreview = path.match(/^\/workspaces\/([^/]+)\/context-preview$/);
  const comparison = path.match(/^\/workspaces\/([^/]+)\/comparison$/);
  const generationCollection = path.match(/^\/workspaces\/([^/]+)\/generations$/);
  const topicMember = path.match(/^\/topics\/([^/]+)(?:\/(move|context|archive|restore))?$/);
  const archivedTopics = path.match(/^\/workspaces\/([^/]+)\/archived-topics$/);
  const nodeMember = path.match(/^\/nodes\/([^/]+)\/(context|pin|prune)$/);
  try {
    if (collection && request.method === 'GET') { json(response, 200, await dependencies.conversations.list()); return; }
    if (collection && request.method === 'POST') {
      const body = await readBody(request); const validation = validateCreateConversationRequest(body);
      if (!validation.success) { json(response, 400, errorBody('validation_error', 'Invalid conversation payload.', validation.errors)); return; }
      json(response, 201, await dependencies.conversations.create(validation.data)); return;
    }
    if (member) {
      const [, resource, id] = member;
      const workspaceRoute = resource === 'workspaces';
      if (!uuidPattern.test(id)) { json(response, 400, errorBody('invalid_id', `${workspaceRoute ? 'workspaceId' : 'conversationId'} must be a valid UUID.`)); return; }
      if (request.method === 'GET') {
        const graph = await dependencies.conversations.get(id);
        json(response, 200, workspaceRoute ? workspaceGraph(graph) : graph);
        return;
      }
      if (request.method === 'PATCH') {
        const body = await readBody(request); const validation = validateUpdateConversationRequest(body);
        if (!validation.success) { json(response, 400, errorBody('validation_error', 'Invalid conversation payload.', validation.errors)); return; }
        json(response, 200, await dependencies.conversations.update(id, validation.data)); return;
      }
      if (request.method === 'DELETE') { await dependencies.conversations.delete(id); response.writeHead(204); response.end(); return; }
    }
    if (treeMakerPreview && request.method === 'POST') {
      if (!uuidPattern.test(treeMakerPreview[1])) { json(response, 400, errorBody('invalid_id', 'workspaceId must be a valid UUID.')); return; }
      if (!dependencies.treeMaker) { json(response, 500, errorBody('configuration_error', 'TreeMaker service is not configured.')); return; }
      const validation = TreeMakerPreviewRequestSchema.safeParse(await readBody(request));
      if (!validation.success) { json(response, 400, errorBody('validation_error', 'Invalid TreeMaker preview payload.', validation.errors)); return; }
      json(response, 200, await dependencies.treeMaker.preview(treeMakerPreview[1], validation.data)); return;
    }
    if (contextPreview && request.method === 'POST') {
      if (!uuidPattern.test(contextPreview[1])) { json(response, 400, errorBody('invalid_id', 'workspaceId must be a valid UUID.')); return; }
      if (!dependencies.contextPreview) { json(response, 500, errorBody('configuration_error', 'Context preview service is not configured.')); return; }
      const validation = ContextPreviewRequestSchema.safeParse(await readBody(request));
      if (!validation.success) { json(response, 400, errorBody('validation_error', 'Invalid context preview payload.', validation.errors)); return; }
      json(response, 200, await dependencies.contextPreview.preview(contextPreview[1], validation.data)); return;
    }
    if (comparison && request.method === 'POST') {
      if (!uuidPattern.test(comparison[1])) { json(response, 400, errorBody('invalid_id', 'workspaceId must be a valid UUID.')); return; }
      if (!dependencies.comparisons) { json(response, 500, errorBody('configuration_error', 'Comparison service is not configured.')); return; }
      const validation = ComparisonRequestSchema.safeParse(await readBody(request));
      if (!validation.success) { json(response, 400, errorBody('validation_error', 'Invalid comparison payload.', validation.errors)); return; }
      json(response, 200, await dependencies.comparisons.compare(comparison[1], validation.data)); return;
    }
    if (generationCollection && request.method === 'POST') {
      if (!uuidPattern.test(generationCollection[1])) { json(response, 400, errorBody('invalid_id', 'workspaceId must be a valid UUID.')); return; }
      if (!dependencies.generations) { json(response, 500, errorBody('configuration_error', 'Generation service is not configured.')); return; }
      const validation = GenerationRequestSchema.safeParse(await readBody(request));
      if (!validation.success) { json(response, 400, errorBody('validation_error', 'Invalid generation payload.', validation.errors)); return; }
      json(response, 202, await dependencies.generations.start(generationCollection[1], validation.data)); return;
    }
    if (archivedTopics && request.method === 'GET') {
      if (!uuidPattern.test(archivedTopics[1])) { json(response, 400, errorBody('invalid_id', 'workspaceId must be a valid UUID.')); return; }
      json(response, 200, { topics: await dependencies.conversations.archivedTopics(archivedTopics[1]) }); return;
    }
    if (topicCollection && request.method === 'POST') {
      if (!uuidPattern.test(topicCollection[1])) { json(response, 400, errorBody('invalid_id', 'workspaceId must be a valid UUID.')); return; }
      const body = await readBody(request); const validation = validateCreateTopicRequest(body);
      if (!validation.success) { json(response, 400, errorBody('validation_error', 'Invalid topic payload.', validation.errors)); return; }
      json(response, 201, await dependencies.conversations.createTopic(topicCollection[1], validation.data)); return;
    }
    if (topicMember) {
      const id = topicMember[1]; const action = topicMember[2];
      if (!uuidPattern.test(id)) { json(response, 400, errorBody('invalid_id', 'topicId must be a valid UUID.')); return; }
      if (action === 'move' && request.method === 'POST') { const validation = validateMoveTopicRequest(await readBody(request)); if (!validation.success) { json(response, 400, errorBody('validation_error', 'Invalid move payload.', validation.errors)); return; } json(response, 200, await dependencies.conversations.moveTopic(id, validation.data.parentTopicId)); return; }
      if (action === 'archive' && request.method === 'POST') { json(response, 200, await dependencies.conversations.archiveTopic(id)); return; }
      if (action === 'restore' && request.method === 'POST') { json(response, 200, await dependencies.conversations.restoreTopic(id)); return; }
      if (action === 'context' && request.method === 'PATCH') { const validation = validateContextRequest(await readBody(request)); if (!validation.success) { json(response, 400, errorBody('validation_error', 'Invalid context payload.', validation.errors)); return; } json(response, 200, await dependencies.conversations.setTopicContext(id, validation.data.contextEnabled)); return; }
      if (!action && request.method === 'PATCH') { const validation = validateUpdateTopicRequest(await readBody(request)); if (!validation.success) { json(response, 400, errorBody('validation_error', 'Invalid topic payload.', validation.errors)); return; } json(response, 200, await dependencies.conversations.updateTopic(id, validation.data)); return; }
    }
    if (nodeMember) {
      const id = nodeMember[1]; const action = nodeMember[2];
      if (!uuidPattern.test(id)) { json(response, 400, errorBody('invalid_id', 'nodeId must be a valid UUID.')); return; }
      if (action === 'context' && request.method === 'PATCH') { const validation = validateContextRequest(await readBody(request)); if (!validation.success) { json(response, 400, errorBody('validation_error', 'Invalid context payload.', validation.errors)); return; } json(response, 200, await dependencies.conversations.setNodeContext(id, validation.data.contextEnabled)); return; }
      if (action === 'pin' && request.method === 'PATCH') { const validation = validatePinRequest(await readBody(request)); if (!validation.success) { json(response, 400, errorBody('validation_error', 'Invalid pin payload.', validation.errors)); return; } json(response, 200, await dependencies.conversations.setNodePinned(id, validation.data.pinned)); return; }
      if (action === 'prune' && request.method === 'POST') { json(response, 200, await dependencies.conversations.pruneNode(id)); return; }
    }
    json(response, 405, errorBody('method_not_allowed', 'Method not allowed.'));
  } catch (error) {
    if (error instanceof ConversationNotFoundError) { json(response, 404, errorBody('conversation_not_found', 'Conversation not found.')); return; }
    if (error instanceof TreeMakerWorkspaceNotFoundError) { json(response, 404, errorBody('workspace_not_found', 'Workspace not found.')); return; }
    if (error instanceof ContextPreviewWorkspaceNotFoundError) { json(response, 404, errorBody('workspace_not_found', 'Workspace not found.')); return; }
    if (error instanceof ComparisonWorkspaceNotFoundError) { json(response, 404, errorBody('workspace_not_found', 'Workspace not found.')); return; }
    if (error instanceof GenerationWorkspaceNotFoundError) { json(response, 404, errorBody('workspace_not_found', 'Workspace not found.')); return; }
    if (error instanceof ContextEngineValidationError) { json(response, 400, errorBody('context_validation_error', error.message)); return; }
    if (error instanceof GenerationValidationError) { json(response, 400, errorBody('generation_validation_error', error.message)); return; }
    if (error instanceof ComparisonValidationError) { json(response, 400, errorBody('comparison_validation_error', error.message)); return; }
    if (error instanceof TopicValidationError) { json(response, 400, errorBody('topic_validation_error', error.message)); return; }
    if (error instanceof Error && error.message === 'invalid_json') { json(response, 400, errorBody('invalid_json', 'Request body must be valid JSON.')); return; }
    json(response, 500, errorBody('internal_error', 'An unexpected error occurred.'));
  }
}

export function createApiServer(config = getConfig()) {
  const db = new PrismaClient();
  const repository = new ConversationRepository(db);
  const provider = createAiProvider(config);
  const treeMakerModel = config.treeMakerModel ?? 'mock-tree-maker';
  const treeMaker = new TreeMakerApplicationService(new PrismaTreeMakerStore(repository), new ProviderTreeMaker(provider, treeMakerModel), provider.name, treeMakerModel, { high: config.treeMakerHighConfidence ?? 0.85, medium: config.treeMakerLowConfidence ?? 0.55 });
  const realtime = new RealtimeGateway();
  const capsules = new ContextCapsuleService(new PrismaContextCapsuleStore(repository), provider, config.capsuleModel ?? 'mock-capsule');
  const generationEvents = { publish(event: import('./generation.service.js').GenerationEvent) {
    switch (event.type) {
      case 'tree_maker.completed': realtime.publish(event.workspaceId, null, { eventType: 'tree_maker.completed', decision: event.decision as never }); break;
      case 'tree_maker.clarification_required': realtime.publish(event.workspaceId, null, { eventType: 'tree_maker.clarification_required', question: event.question, suggestedTopicIds: event.suggestedTopicIds }); break;
      case 'assistant.delta': realtime.publish(event.workspaceId, event.generationId, { eventType: 'assistant.delta', assistantNodeId: event.assistantNodeId, delta: event.delta }); break;
      case 'assistant.completed': realtime.publish(event.workspaceId, event.generationId, { eventType: 'assistant.completed', assistantNodeId: event.assistantNodeId, content: event.content }); break;
      case 'assistant.failed': realtime.publish(event.workspaceId, event.generationId, { eventType: 'assistant.failed', assistantNodeId: event.assistantNodeId, error: event.error }); realtime.publish(event.workspaceId, event.generationId, { eventType: 'generation.failed', assistantNodeId: event.assistantNodeId, error: event.error }); break;
      case 'capsule.updated': realtime.publish(event.workspaceId, event.generationId, { eventType: 'capsule.updated', topicId: event.topicId, capsule: event.capsule }); break;
      case 'topic.created': realtime.publish(event.workspaceId, event.generationId, { eventType: 'topic.created', topic: event.topic as never }); break;
      case 'node.created': realtime.publish(event.workspaceId, event.generationId, { eventType: 'node.created', node: event.node as never }); break;
    }
  } };
  const conversationEvents = { publish(event: import('./conversations.service.js').ConversationGraphEvent) {
    if (event.eventType === 'topic.moved') realtime.publish(event.workspaceId, null, { eventType: 'topic.moved', topicId: event.topicId, parentTopicId: event.parentTopicId });
    else if (event.eventType === 'node.pruned') realtime.publish(event.workspaceId, null, { eventType: 'node.pruned', nodeId: event.nodeId, prunedNodeIds: event.prunedNodeIds, activeNodeId: event.activeNodeId } as never);
    else if ('topic' in event) realtime.publish(event.workspaceId, null, { eventType: event.eventType, topic: event.topic } as never);
    else if ('node' in event) realtime.publish(event.workspaceId, null, { eventType: event.eventType, node: event.node } as never);
  } };
  const conversations = new ConversationService(db, conversationEvents);
  const dependencies = {
    conversations,
    comparisons: new ComparisonApplicationService({
      async load(workspaceId) {
        try {
          const graph = await conversations.get(workspaceId);
          return { exists: true, topics: graph.topics, nodes: graph.nodes };
        } catch (error) {
          if (error instanceof ConversationNotFoundError) return { exists: false, topics: [], nodes: [] };
          throw error;
        }
      },
    }),
    treeMaker,
    contextPreview: new ContextPreviewApplicationService(new PrismaContextPreviewStore(repository)),
    generations: new GenerationApplicationService(new PrismaGenerationStore(repository, db), provider, config.answerModel ?? 'mock-answer', treeMaker, undefined, config.maxInputTokens ?? null, generationEvents, async (input) => {
      const result = await capsules.updateAfterSuccessfulResponse(input);
      return result.status === 'updated' ? result.capsule : null;
    }),
  };
  const server = createServer((request, response) => { void handleApiRequest(config, request, response, dependencies); });
  realtime.attach(server, config.wsPath);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = getConfig();
  createApiServer(config).listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
}
