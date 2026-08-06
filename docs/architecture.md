# ArborAI architecture

## Current repository state

ArborAI is currently an empty application scaffold. The architecture below is the intended baseline for the implementation tickets that follow; no Next.js app, NestJS app, database schema, WebSocket server, or Docker setup exists in this commit.

## Components

### Web application

`apps/web/` will contain the Next.js frontend and React Flow conversation workspace. It will render the conversation tree, track the selected/active node, submit prompts, and consume streamed response events from the API.

### API application

`apps/api/` will contain the NestJS backend. It will expose conversation and prompt operations, coordinate context assembly and model execution, persist tree changes, and publish response-stream events over WebSockets.

The conversation REST API currently exposes `GET/POST /conversations` and `GET/PATCH/DELETE /conversations/:conversationId`. Creation and updates validate a non-empty title (maximum 200 characters) and a system prompt of at most 10,000 characters. Collection results are ordered by most recently updated conversation; tree nodes are ordered by creation time. A conversation load returns metadata plus all non-pruned nodes, including `parentId` and `activeNodeId`. Invalid UUIDs return `400` and missing conversations return `404` with `{ "error": { "code": "...", "message": "..." } }`.

### Shared package

`packages/shared/` contains the contracts shared by the web and API applications: conversation DTOs, node enums, WebSocket event names, and dependency-free runtime validators for external request payloads. Its public API is exported from `packages/shared/src/index.ts`, and the package must remain independent of both applications.

### Persistence

PostgreSQL will persist conversations and their nodes. The primary relationship is the node `parentId`, which forms a tree while `conversationId` scopes nodes to a conversation.

## Conversation tree data model

```text
Conversation
  id
  title
  systemPrompt
  activeNodeId
  createdAt
  updatedAt

ConversationNode
  id
  conversationId
  parentId
  role
  content
  status
  tokenCount
  errorMessage
  prunedAt
  createdAt
  updatedAt
```

Submitting a prompt from an existing node creates a new user node whose `parentId` is the selected node. The API then creates an assistant node beneath it and updates that node as the response streams.

## Context assembly

The context-management engine starts at the selected node and walks parent links toward the root. It orders the relevant messages chronologically, adds the conversation system prompt, and assembles the model request. This keeps unrelated sibling branches out of the request while allowing users to revisit and branch from prior history. Token counts are recorded on nodes so the implementation can measure context size and benchmark reductions.

## Request and streaming lifecycle

1. The web client selects a node and submits a prompt.
2. The API validates the request and creates a user node under the selected node.
3. The API assembles context by walking that node's ancestry, then creates a pending assistant node.
4. The API invokes the configured model provider. Development and CI must support a mock/offline provider without a paid API key.
5. As output arrives, the API persists partial assistant content and emits WebSocket events for the node/status/content update.
6. The web client applies those events to the React Flow graph and renders the streaming response.
7. On completion, the API records the final status and token count. On failure, it records `errorMessage` and emits an error/completion event.

WebSocket event names belong in `packages/shared/` and are exposed through the `WebSocketEvent` constant. Any contract change must be reflected in the relevant documentation and tests. The current request validators cover conversation creation, branch creation, and generation-start payloads; response and event payload validation can be extended as those transports are implemented.

## Persistence

Prisma manages the PostgreSQL schema in `apps/api/prisma`. Deleting a conversation cascades to its nodes. Deleting an individual node sets its children's `parentId` to null, preserving those nodes; application code must still validate that a new parent belongs to the same conversation. `prunedAt` is a soft-prune marker: normal repository queries exclude marked nodes, while the rows remain recoverable.

The initial migration creates indexes for conversation lookup, parent lookup, and conversation chronology. The development seed creates one conversation with a prompt/response path and two branches.

## Local development

PostgreSQL is configured with `DATABASE_URL` in `.env`. From the repository root, use `npm run db:migrate --workspace @arborai/api` to apply migrations and `npm run db:seed --workspace @arborai/api` to add development data. `npm run db:reset --workspace @arborai/api` is destructive and intended only for local development; it resets the database and runs the seed automatically. Keep `AI_PROVIDER=mock` for offline development.
