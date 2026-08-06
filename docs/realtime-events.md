# Realtime events

Realtime keeps the React Flow graph current during routing and streaming. Event
names and envelope types are shared from `packages/shared/`; the current
scaffold has constants but no WebSocket transport yet.

## Envelope

```ts
interface RealtimeEvent<T> {
  eventId: string;
  eventType: string;
  workspaceId: string;
  generationId: string | null;
  occurredAt: string;
  payload: T;
}
```

`eventId` supports client deduplication. Every event is scoped to one workspace.
Delta payloads identify their assistant node; clients must not append completed
content twice. After reconnecting, clients rejoin then refetch the graph rather
than assuming missed events can be replayed.

## Names

Client-to-server: `conversation.join`, `conversation.leave` (each includes the
workspace ID; the compatibility name remains until a deliberate rename).

Server-to-client:

```text
conversation.joined
tree_maker.completed
tree_maker.clarification_required
topic.created
topic.updated
topic.moved
topic.context_updated
topic.archived
topic.restored
node.created
node.updated
node.context_updated
node.pruned
assistant.delta
assistant.completed
assistant.failed
capsule.updated
generation.failed
```

The gateway must scope events to a workspace. Until a gateway exists, REST
refetch remains the source of truth.
