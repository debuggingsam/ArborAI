import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { getConfig, type ApiConfig } from './config.js';
import { ConversationService, ConversationNotFoundError, TopicValidationError } from './conversations.service.js';
import { validateCreateConversationRequest, validateUpdateConversationRequest, validateCreateTopicRequest, validateUpdateTopicRequest, validateMoveTopicRequest, validateContextRequest, validatePinRequest, TreeMakerPreviewRequestSchema } from '@arborai/shared';
import { ConversationRepository } from './repositories/conversation.repository.js';
import { PrismaTreeMakerStore } from './tree-maker.repository.js';
import { TreeMakerApplicationService, TreeMakerWorkspaceNotFoundError } from './tree-maker.service.js';

type Dependencies = { conversations: ConversationService; treeMaker?: TreeMakerApplicationService };
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
  const topicMember = path.match(/^\/topics\/([^/]+)(?:\/(move|context|archive|restore))?$/);
  const nodeMember = path.match(/^\/nodes\/([^/]+)\/(context|pin)$/);
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
    if (nodeMember && request.method === 'PATCH') {
      const id = nodeMember[1]; const action = nodeMember[2];
      if (!uuidPattern.test(id)) { json(response, 400, errorBody('invalid_id', 'nodeId must be a valid UUID.')); return; }
      if (action === 'context') { const validation = validateContextRequest(await readBody(request)); if (!validation.success) { json(response, 400, errorBody('validation_error', 'Invalid context payload.', validation.errors)); return; } json(response, 200, await dependencies.conversations.setNodeContext(id, validation.data.contextEnabled)); return; }
      if (action === 'pin') { const validation = validatePinRequest(await readBody(request)); if (!validation.success) { json(response, 400, errorBody('validation_error', 'Invalid pin payload.', validation.errors)); return; } json(response, 200, await dependencies.conversations.setNodePinned(id, validation.data.pinned)); return; }
    }
    json(response, 405, errorBody('method_not_allowed', 'Method not allowed.'));
  } catch (error) {
    if (error instanceof ConversationNotFoundError) { json(response, 404, errorBody('conversation_not_found', 'Conversation not found.')); return; }
    if (error instanceof TreeMakerWorkspaceNotFoundError) { json(response, 404, errorBody('workspace_not_found', 'Workspace not found.')); return; }
    if (error instanceof TopicValidationError) { json(response, 400, errorBody('topic_validation_error', error.message)); return; }
    if (error instanceof Error && error.message === 'invalid_json') { json(response, 400, errorBody('invalid_json', 'Request body must be valid JSON.')); return; }
    json(response, 500, errorBody('internal_error', 'An unexpected error occurred.'));
  }
}

export function createApiServer(config = getConfig()) {
  const db = new PrismaClient();
  const repository = new ConversationRepository(db);
  const dependencies = { conversations: new ConversationService(db), treeMaker: new TreeMakerApplicationService(new PrismaTreeMakerStore(repository), undefined, config.aiProvider) };
  return createServer((request, response) => { void handleApiRequest(config, request, response, dependencies); });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = getConfig();
  createApiServer(config).listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
}
