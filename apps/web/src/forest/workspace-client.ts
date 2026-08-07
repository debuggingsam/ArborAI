import type { GenerationRequest, GenerationResponse, WebSocketEventEnvelope, WebSocketPayload } from '@arborai/shared';
import type { WorkspaceResponse } from '../conversation-tree.js';

export async function requestGeneration(baseUrl: string, workspaceId: string, request: GenerationRequest, fetcher: typeof fetch = fetch): Promise<GenerationResponse> {
  const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/workspaces/${encodeURIComponent(workspaceId)}/generations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Generation request failed (${response.status}).`);
  }
  return response.json() as Promise<GenerationResponse>;
}

const replace = <T extends { id: string }>(items: T[], item: T) => items.some((current) => current.id === item.id) ? items.map((current) => current.id === item.id ? item : current) : [...items, item];

/** Applies individual realtime events immutably; REST remains authoritative after reconnect. */
export function applyWorkspaceEvent(tree: WorkspaceResponse, event: WebSocketEventEnvelope): WorkspaceResponse {
  const payload = event.payload as WebSocketPayload;
  switch (payload.eventType) {
    case 'topic.created': case 'topic.updated': case 'topic.context_updated': case 'topic.archived': case 'topic.restored':
      return { ...tree, topics: replace(tree.topics, payload.topic) };
    case 'topic.moved': return { ...tree, topics: tree.topics.map((topic) => topic.id === payload.topicId ? { ...topic, parentTopicId: payload.parentTopicId } : topic) };
    case 'node.created': case 'node.updated': case 'node.context_updated':
      return { ...tree, nodes: replace(tree.nodes, payload.node) };
    case 'node.pruned': case 'subtree.pruned': {
      const pruned = new Set(payload.prunedNodeIds ?? [payload.nodeId]);
      return { ...tree, nodes: tree.nodes.filter((node) => !pruned.has(node.id)), topics: payload.activeNodeId === undefined ? tree.topics : tree.topics.map((topic) => topic.activeNodeId && pruned.has(topic.activeNodeId) ? { ...topic, activeNodeId: payload.activeNodeId ?? null } : topic) };
    }
    case 'assistant.delta': return { ...tree, nodes: tree.nodes.map((node) => node.id === payload.assistantNodeId ? { ...node, status: 'streaming', content: `${node.content}${payload.delta}` } : node) };
    case 'assistant.completed': return { ...tree, nodes: tree.nodes.map((node) => node.id === payload.assistantNodeId ? { ...node, status: 'completed', content: payload.content } : node) };
    case 'assistant.failed': return { ...tree, nodes: tree.nodes.map((node) => node.id === payload.assistantNodeId ? { ...node, status: 'error', errorMessage: payload.error } : node) };
    case 'capsule.updated': return { ...tree, topics: tree.topics.map((topic) => topic.id === payload.topicId ? { ...topic, contextCapsule: payload.capsule } : topic) };
    default: return tree;
  }
}
