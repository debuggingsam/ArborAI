# API contracts

The workspace response is returned by `GET /conversations/:conversationId`:

```json
{ "conversation": {}, "topics": [], "nodes": [], "activeTopicId": "uuid|null" }
```

Topics expose `id`, `conversationId`, `parentTopicId`, `title`, `description`, `activeNodeId`, `contextEnabled`, `archivedAt`, `createdAt`, and `updatedAt`. Message nodes expose their existing fields plus `topicId` and `contextEnabled`.

Endpoints: `POST /conversations/:conversationId/topics`, `PATCH /topics/:topicId`, `PATCH /topics/:topicId/context`, `POST /topics/:topicId/archive`, `POST /topics/:topicId/restore`, and `PATCH /nodes/:nodeId/context`.

Generation requests support a selected topic/node path and a mode such as `continue` or `regenerate`; generation remains provider-abstracted and mock-capable. WebSocket events include node creation, assistant deltas, completion, failure, context-state changes, and subtree pruning. Event names remain centralized in `packages/shared`.
