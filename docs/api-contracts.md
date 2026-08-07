# API contracts

This document defines the target public contract. The currently implemented
compatibility endpoints use `/conversations`; their exact state is recorded in
`docs/project-status.md`. Do not silently repurpose existing payloads while
migrating to `/workspaces`.

## Conventions

Workspace is the product term; `Conversation` may remain a database and
temporary compatibility name. Normal graph responses omit archived topics and
pruned nodes. Errors use:

```json
{ "error": { "code": "string", "message": "string", "details": [] } }
```

All externally supplied payloads and model structured output require shared
runtime validation. IDs referenced by a request must belong to their asserted
workspace/topic.

## Target REST resources

| Resource | Routes |
| --- | --- |
| Health | `GET /health` (API and database health) |
| Workspaces | `GET, POST /workspaces`; `GET, PATCH, DELETE /workspaces/:workspaceId`; `GET /workspaces/:workspaceId/archived-topics` |
| Topics | `POST /workspaces/:workspaceId/topics`; `PATCH /topics/:topicId`; `POST /topics/:topicId/move`; `PATCH /topics/:topicId/context`; `POST /topics/:topicId/archive`; `POST /topics/:topicId/restore` |
| Messages | `PATCH /nodes/:nodeId/context`; `PATCH /nodes/:nodeId/pin`; `POST /nodes/:nodeId/prune` |
| TreeMaker preview | `POST /workspaces/:workspaceId/tree-maker/preview` |
| Context preview | `POST /workspaces/:workspaceId/context-preview` |
| Comparison | `POST /workspaces/:workspaceId/comparison` |
| Generation | `POST /workspaces/:workspaceId/generations` |

`GET /workspaces/:workspaceId` returns:

```ts
interface WorkspaceGraphResponse {
  workspace: WorkspaceDto;
  topics: TopicDto[];
  nodes: MessageNodeDto[];
  activeTopicId: string | null;
}
```

Topic moves reject cross-workspace targets, self-parenting, descendant moves,
and archived parents unless explicitly supported.

`GET /workspaces/:workspaceId/archived-topics` returns `{ topics }` for the
restoration view. It includes directly archived topics and descendants hidden
because of an archived ancestor; normal graph reads still omit both. `POST
/nodes/:nodeId/prune` soft-prunes the selected node and its descendants,
returns the affected count and active-node fallback, and rejects branches with
pending or streaming nodes.

## Preview contracts

TreeMaker preview accepts `{ prompt, activeTopicId, activeNodeId }` and returns
`{ decision, requiresConfirmation }`; it never mutates the graph. It does
persist one `TreeMakerRun` audit record for every validated decision or safe
fallback. A decision is one of `continue_topic`, `create_subtopic`,
`create_root_topic`, or `ask_user`.

Context preview accepts `{ topicId, anchorNodeId, newPrompt, maxInputTokens }`
and returns the exact Context Engine result: ordered serialized messages with
`sourceType` (`workspace_system_prompt`, `topic_capsule`, `message_node`, or
`new_prompt`) and nullable `sourceId`, included and excluded IDs, exclusions,
warnings, trimmed IDs, and estimated token count. It is read-only and includes
archived/pruned records only to explain their exclusions.

Comparison accepts two distinct selections, `{ left: { type: "topic" | "node",
id }, right: { type: "topic" | "node", id } }`. It is read-only and returns
the nearest common topic/message IDs, shared topic/message paths, and the
left/right-only path segments. Independent root topics have null nearest-common
IDs and empty shared paths; the endpoint never invents shared context.

## Generation contract

Generation requests are a discriminated union with these modes:

| Mode | Required placement fields |
| --- | --- |
| `auto_route` | `prompt`, `activeTopicId`, `activeNodeId` |
| `manual_continue` | `prompt`, `topicId`, `anchorNodeId` |
| `manual_subtopic` | `prompt`, `parentTopicId`, optional `title`, `description` |
| `manual_root_topic` | `prompt`, optional `title`, `description` |
| `regenerate` | `userNodeId` |

The accepted response is `{ generationId, treeMakerRunId, topicId, userNodeId,
assistantNodeId, status, clarification }`, where `status` is `accepted` or
`clarification_required`. Clarification supplies a question and suggested topic
IDs. A snapshot is persisted before answer streaming begins. Accepted work runs
asynchronously; clients receive terminal state and text deltas through the
workspace WebSocket room, while REST graph reads remain authoritative after a
reconnect.

Shared DTOs, enums, runtime schemas, and realtime names belong in
`packages/shared/`; see `docs/realtime-events.md` for transport envelopes.
