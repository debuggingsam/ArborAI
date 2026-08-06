# ArborAI architecture

## Current repository state

ArborAI is currently an empty application scaffold. The architecture below is the intended baseline for the implementation tickets that follow; no Next.js app, NestJS app, database schema, WebSocket server, or Docker setup exists in this commit.

## Components

### Web application

`apps/web/` will contain the Next.js frontend and React Flow conversation workspace. It will render the conversation tree, track the selected/active node, submit prompts, and consume streamed response events from the API.

### API application

`apps/api/` will contain the NestJS backend. It will expose conversation and prompt operations, coordinate context assembly and model execution, persist tree changes, and publish response-stream events over WebSockets.

### Shared package

`packages/shared/` will contain contracts shared by the web and API applications: DTOs, event names, enums, and validation schemas. It must remain independent of both applications.

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

WebSocket event names and payloads belong in `packages/shared/` once implemented. Any contract change must be reflected in the relevant documentation and tests.

## Local development

The application directories, Docker Compose configuration, database migrations, and environment variables have not yet been implemented. See `.env.example` for the planned configuration surface and `AGENTS.md` for the currently available root commands.
