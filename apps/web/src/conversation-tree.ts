export interface ConversationNode {
  id: string; conversationId: string; parentId: string | null; role: string; content: string;
  status: string; tokenCount: number | null; errorMessage: string | null; prunedAt: string | null;
  createdAt: string; updatedAt: string;
}
export interface ConversationTreeResponse { conversation: { activeNodeId: string | null }; nodes: ConversationNode[] }

export type FlowNode = { id: string; type: 'conversation'; position: { x: number; y: number }; data: { node: ConversationNode; active: boolean; ancestor: boolean } };
export type FlowEdge = { id: string; source: string; target: string; active: boolean };

const columnGap = 260;
const rowGap = 150;

export function truncateContent(content: string, maxLength = 120): string {
  const singleLine = content.replace(/\s+/g, ' ').trim();
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 1)}…`;
}

export function ancestorIds(nodes: ConversationNode[], selectedId: string | null): Set<string> {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const result = new Set<string>();
  let current = selectedId ? byId.get(selectedId) : undefined;
  while (current) {
    result.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return result;
}

export function toFlowGraph(response: ConversationTreeResponse, selectedId: string | null = response.conversation.activeNodeId): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const selectedAncestors = ancestorIds(response.nodes, selectedId);
  const children = new Map<string | null, ConversationNode[]>();
  response.nodes.forEach(node => children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]));
  const positions = new Map<string, { x: number; y: number }>();
  let nextRow = 0;
  const place = (parentId: string | null, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      const descendants = children.get(node.id) ?? [];
      if (descendants.length) place(node.id, depth + 1);
      const childRows = descendants.map(child => positions.get(child.id)?.y ?? 0);
      const y = childRows.length ? childRows.reduce((sum, value) => sum + value, 0) / childRows.length : nextRow++ * rowGap;
      positions.set(node.id, { x: depth * columnGap, y });
    }
  };
  place(null, 0);
  const nodes: FlowNode[] = response.nodes.map(node => ({ id: node.id, type: 'conversation', position: positions.get(node.id) ?? { x: 0, y: nextRow++ * rowGap }, data: { node, active: node.id === selectedId, ancestor: selectedAncestors.has(node.id) } }));
  const edges = response.nodes.filter(node => node.parentId).map(node => ({ id: `${node.parentId}-${node.id}`, source: node.parentId as string, target: node.id, active: selectedAncestors.has(node.id) && selectedAncestors.has(node.parentId as string) }));
  return { nodes, edges };
}
