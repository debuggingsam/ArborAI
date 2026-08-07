import type { ContextPreviewRequest, ContextPreviewResponse } from '@arborai/shared';
import { ContextEngine, ContextEngineValidationError, type ContextEngineNode, type ContextEngineTopic } from './context-engine.service.js';

export type ContextPreviewWorkspaceRecord = { id: string; systemPrompt: string | null };
export interface ContextPreviewStore {
  findWorkspace(id: string): Promise<ContextPreviewWorkspaceRecord | null>;
  listTopics(workspaceId: string): Promise<ContextEngineTopic[]>;
  listNodes(workspaceId: string): Promise<ContextEngineNode[]>;
}

export class ContextPreviewWorkspaceNotFoundError extends Error {}

/**
 * Read-only application boundary for the Context Engine. Generation will use
 * this same engine and input shape when its lifecycle is added.
 */
export class ContextPreviewApplicationService {
  constructor(private readonly store: ContextPreviewStore, private readonly contextEngine = new ContextEngine()) {}

  async preview(workspaceId: string, request: ContextPreviewRequest): Promise<ContextPreviewResponse> {
    const workspace = await this.store.findWorkspace(workspaceId);
    if (!workspace) throw new ContextPreviewWorkspaceNotFoundError();
    const [topics, nodes] = await Promise.all([this.store.listTopics(workspaceId), this.store.listNodes(workspaceId)]);
    return this.contextEngine.assemble({
      workspace,
      topics,
      nodes,
      topicId: request.topicId,
      anchorNodeId: request.anchorNodeId,
      newPrompt: request.newPrompt,
      maxInputTokens: request.maxInputTokens,
    });
  }
}

export { ContextEngineValidationError };
