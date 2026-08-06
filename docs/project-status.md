# Project status

Audited on 2026-08-06 against `docs/refactor-spec.md`. Ticket 04 adds an
idempotent legacy-message backfill marker, compact migration capsules,
validation reporting, and a comprehensive graph seed. Ticket 05 centralizes
runtime-validated frontend/backend contracts. Neither ticket adds TreeMaker,
Context Engine, provider, or generation orchestration.

## Executive summary

The repository is an npm multi-package repository (not an npm-workspaces monorepo):

- `apps/web` is a Vite + React 19 + React Flow application, not Next.js.
- `apps/api` is a Node `http` server with Prisma, not NestJS.
- `packages/shared` is a dependency-free TypeScript contracts package.
- PostgreSQL is the configured datastore; five Prisma SQL migrations define conversations, topics/capsules, message nodes, TreeMaker runs, generations, immutable context snapshots, and legacy-backfill support.

The codebase has already completed part of the topic-domain migration: a topic has a distinct hierarchy from a message node, message nodes reference a topic, and the web graph renders topic and message nodes differently. It has not implemented the TreeMaker, context-capsule, deterministic context-engine, generation, provider, realtime, correction, or end-to-end workflow required by the refactor specification.

The existing root quality commands pass. There is no Docker Compose configuration, GitHub Actions workflow, or browser/integration-test setup. The current root `dev` command starts the Vite app and API processes. It was attempted during this audit but the sandbox denied Vite binding `0.0.0.0:5173` with `EPERM`; this is an environment restriction, not evidence of an application compile failure.

## Current implementation inventory

| Area | Current state |
| --- | --- |
| Package manager | npm, with a root helper (`scripts/run-workspaces.mjs`) that runs scripts in `apps/web`, `apps/api`, and `packages/shared`. The root `package.json` does **not** declare `workspaces`. |
| Web app | Vite, React, React Flow, TypeScript. The Vite entry is `src/main.tsx`; `src/server.ts` and its browser client are legacy/unreferenced by Vite. |
| API app | TypeScript ESM Node `http` server; Prisma client. No NestJS modules/controllers/gateway. |
| Shared package | Runtime schemas and inferred types for workspaces, topics/capsules, message nodes, TreeMaker input/decisions, context previews, generation modes/responses, and realtime envelopes/payloads. API and web import its compatibility DTOs and validators. |
| Persistence | Prisma/PostgreSQL schema and four committed SQL migrations. Topics are first-class; TreeMaker runs, generations, and immutable context snapshots are persisted. |
| Realtime | No WebSocket server or client connection. `WS_PATH` and event constants are unused by a transport. |
| Providers/generation | Mock-only configuration validation exists, but no provider adapter, context assembly, generation endpoint, streaming, or persistence. |
| Infrastructure | No `docker-compose.yml`, Dockerfiles, or GitHub Actions files. |

## Compatible functionality to retain

These behaviors are compatible with the target architecture and should be preserved or extended rather than replaced:

- `Conversation` can remain the persistence name for a product-facing workspace.
- Conversation CRUD is implemented at `GET/POST /conversations` and `GET/PATCH/DELETE /conversations/:conversationId`.
- Conversation title and system-prompt limits are validated for conversation creation/update.
- `Topic` is already a separate model from `ConversationNode`; topics use `parentTopicId` while messages use `parentId`.
- A message has both `conversationId` and `topicId`; repository creation rejects a parent from another conversation or topic.
- Alternative assistant responses can be represented as multiple assistant children of a user node.
- Nodes have status, token-count, error, soft-prune, and independent context-enabled fields.
- Topics have context-enabled, archived, active-node, capsule, version, timestamp, and creation-source fields; conversations have an active-topic field.
- TreeMaker decisions, generation lifecycle metadata, and immutable JSON context snapshots have persistence models, but no TreeMaker, Context Engine, or generation workflow yet uses them.
- Normal conversation loading excludes soft-pruned nodes.
- The seed includes multiple roots, nested subtopics, a linear message thread, alternative assistant responses, disabled topic/message states, a pinned message, a generation snapshot, and a TreeMaker run.
- The React Flow transformation uses distinct `topicNode` and `messageNode` types and separate topic, ownership, and message edges.
- The root quality-command helper and dependency-free shared contracts are suitable foundations.
- `AI_PROVIDER=mock` is required by current API configuration and requires no credential.

## Functionality requiring modification or extension

### Architecture and domain

- The runtime stack is Vite/React and a Node HTTP server, whereas the specification names Next.js/NestJS. Preserve the working stack unless a later ticket makes a deliberate, justified framework migration; there is no current NestJS or Next.js implementation to extend.
- `Topic` needs a validated context capsule, capsule version/update time, and creation source.
- `ConversationNode` needs the required `pinned` state. Node-role `system` exists today but is outside the target message-node role model and needs an explicit compatibility/removal decision.
- `TreeMakerRun`, `Generation`, and `GenerationContextSnapshot` persistence exists; orchestration, validation, and lifecycle services do not.
- The topic and message models require service-level cycle validation, ownership validation for active IDs, and lifecycle rules beyond foreign keys.
- The initial topic migration created one imported topic per conversation and reassigned all legacy nodes. The Ticket 04 follow-up marks that root, adds a compact provenance capsule without transcript copying, and provides a repeatable validation-first backfill command.

### Context and generations

- There is no deterministic Context Engine. `docs/context-rules.md` describes intended behavior, not executable behavior.
- Topic capsules and immutable generation-context snapshots can be stored as JSON, but no capsule service or Context Engine produces them yet. Raw ancestor transcripts are not copied into nodes.
- No token-budget mechanism, context-preview endpoint, or stable exclusion/warning codes exists yet.
- `StartGenerationRequest` and branch/prune/comparison contracts are partially declared in shared code but have no implemented API route or workflow.
- No TreeMaker routing, confidence policy, fallback, structured-output validation, or mock-provider behavior is implemented.
- No streamed assistant state transition is exercised despite the existing node status enum.

### API and realtime

- The API must gain validated workspace/topic/message/generation operations described in the specification, without silently repurposing current public payloads.
- Shared DTOs, discriminated unions, runtime validators, and centralized realtime names/envelopes are in `packages/shared`. The current API has not yet added the target TreeMaker, context-preview, or generation routes that will consume the newer validators.
- There is no WebSocket implementation yet; the centralized realtime contract remains transport-ready only.
- `GET /health` only returns `{ "status": "ok" }`; it does not verify database health.
- Topic route handling is currently broken: `handleApiRequest` rejects every path other than `/conversations` and `/conversations/:id` before evaluating topic/node routes. The topic endpoints documented in `docs/api-contracts.md` therefore currently return `404`.
- Topic/node identifiers are not UUID-validated. Topic update bodies bypass the corresponding validator.
- Conversation detail currently returns archived topics; target normal graph responses must hide archived topics and their descendants.

### Frontend

- The Vite UI loads a conversation list and visualizes a selected graph, but has no workspace creation UI, composer, generation handling, topic actions, archive/context controls, context preview, placement feedback, reconnection state, or correction workflow.
- Topic cards display title/description/context state but no capsule, inherited-disabled, archive, or creation-source state. Message cards lack pinned/alternative relationship and active-path styling.
- Forest placement is deterministic but only assigns initial positions to root messages; child message positions fall back to a generic column/row. It needs a tested layout for full message branches.
- `apps/web/src/server.ts` and `conversations-client.ts` implement a separate static HTML placeholder UI. They are compiled and partially tested but are not the Vite application used by `npm run dev`.

## Functionality to remove or retire safely

- Retire the message-only `toFlowGraph` compatibility transform after callers/tests are migrated to the topic forest; do not remove it before a replacement is covered.
- Retire the unreferenced static server/browser-client path after its viable Vite replacement has equivalent workspace-management coverage.
- Keep the shared validators as the source of truth when adding new API routes; existing conversation-route compatibility remains preserved.
- Use the centralized realtime event names and envelope when a gateway is implemented.
- Do not expose `ConversationNode.role = system` as a normal message-node role in the new API unless a documented compatibility need remains.

## Current database and migration assessment

### Current schema

`Conversation`: `id`, `title`, nullable `systemPrompt`, nullable `activeTopicId`, timestamps.

`Topic`: `id`, `conversationId`, nullable `parentTopicId`, `title`, nullable `description`, nullable `activeNodeId`, `contextEnabled`, nullable `archivedAt`, nullable JSON `contextCapsule`, `capsuleVersion`, nullable `capsuleUpdatedAt`, `createdBy`, timestamps.

`ConversationNode`: `id`, `conversationId`, `topicId`, nullable `parentId`, `role`, `content`, `status`, nullable `tokenCount`, `contextEnabled`, `pinned`, nullable `errorMessage`, nullable `prunedAt`, timestamps.

`TreeMakerRun`: workspace reference, prompt and active IDs, JSON tree input/decision, provider/model, confidence, terminal routing status/error, and timestamp.

`Generation`: workspace/topic/optional TreeMaker run, user and assistant nodes, mode, provider/model, lifecycle status, token counts, error, and timestamps. `GenerationContextSnapshot` has a one-to-one generation reference plus immutable JSON model messages, inclusion/exclusion data, warnings, and token budget metadata.

### Fields needing a future compatibility decision

- `Conversation.activeTopicId`: retain as the workspace active-topic pointer, but add ownership validation and document it as the canonical field.
- `Topic.activeNodeId`: retain, but validate visibility and topic ownership. It is currently not a foreign key.
- `ConversationNode.role = system`: likely deprecated for message-node use; the target system prompt belongs to the workspace/snapshot context.
- `ConversationNode.tokenCount`: may remain as node-level metadata, while generation input/output usage becomes canonical for generation accounting.
- `ConversationNode.contextEnabled`, `Topic.contextEnabled`, `Topic.archivedAt`, and `ConversationNode.prunedAt`: retain; their effective-context semantics need implementation.

### Migration risks

- The topic migration enables `pgcrypto` before using `gen_random_uuid()` so fresh PostgreSQL databases have the required UUID function.
- The `Topic` model has no database constraint ensuring parent topics are in the same conversation or acyclic. Existing data must be audited/validated before enforcing those rules.
- `ConversationNode.parentId` is globally referential but does not enforce same-conversation/same-topic parentage at the database level. The repository only checks this on its own `createNode` path.
- Active topic/node IDs are plain UUID columns without foreign keys, so migration/backfill must detect dangling or cross-owner values.
- A future additive migration must preserve node `parentId`, timestamps where possible, soft-pruned rows, and existing active-node semantics. It must not flatten topics into message nodes or duplicate raw ancestor transcripts.
- Existing imported topics receive `createdBy = migration` and nullable capsules; no historical messages, TreeMaker runs, generations, or snapshots are backfilled.

## Current API response shapes

| Endpoint | Implemented response |
| --- | --- |
| `GET /health` | `{ "status": "ok" }` |
| `GET /conversations` | `Conversation[]`: `id`, `title`, `systemPrompt`, `activeTopicId`, `createdAt`, `updatedAt` |
| `POST /conversations` | `201` plus one `Conversation` |
| `GET /conversations/:id` | `{ "conversation": Conversation, "topics": TopicDto[], "nodes": ConversationNode[], "activeTopicId": string \| null }` |
| `PATCH /conversations/:id` | one updated `Conversation` |
| `DELETE /conversations/:id` | `204` |
| Topic/node context and topic mutation routes | Source code contains handlers and documentation lists routes, but the server’s early route check currently makes them unreachable (`404`). |

Errors use `{ "error": { "code": string, "message": string, "details"?: string[] } }`. Invalid conversation UUIDs return `400`; topic/node UUIDs are not currently validated.

## Current graph assumptions

- A workspace is a `Conversation`.
- Topic hierarchy is `Topic.parentTopicId`; message hierarchy is `ConversationNode.parentId` and should remain separate.
- A message belongs to exactly one topic through `topicId`.
- The graph renders topic-to-topic edges, topic-to-message ownership edges, and message-to-message edges.
- A selected topic highlights its topic ancestry; a selected message identifies its owning topic. There is no implemented context-path calculation.
- Root topics are laid out as a forest. Root message placement is special-cased; nested message layout is incomplete.
- The API includes all unpruned nodes and currently includes archived topics in a normal detail response.

## Test coverage and command gaps

Existing tests cover a small set of validators, root-node parent ownership, pruned-node query filtering, the health handler, the static client REST call, and helper ancestry/truncation. They do not cover topic routes, topic cycles/ownership, active-pointer validation, archives, context state, graph layout branches, generation/provider behavior, WebSockets, database migrations/seeds, real HTTP against PostgreSQL, browser workflows, Docker, or CI.

The per-package `test` glob is `node --test dist/**/*.test.js`. It executes tests in subdirectories but does not execute direct `dist/server.test.js` files; consequently API and web server tests compile but are omitted from `npm test`. This is a command/test-runner defect to correct in a future test-infrastructure ticket.

## Confirmed commands

Run commands from the repository root unless shown otherwise.

| Purpose | Actual command | Status in this audit |
| --- | --- | --- |
| Install | `npm install` | Not run; dependencies were already present. |
| Development | `npm run dev` | Attempted. It starts the web/API scripts concurrently; Vite could not bind `0.0.0.0:5173` in this sandbox (`EPERM`). |
| Formatting | No formatting script or formatter is configured. | Missing. |
| Lint | `npm run lint` | Passed. |
| Type check | `npm run typecheck` | Passed. |
| Unit tests | `npm test` | Passed; executes 7 tests, with the direct-dist test-glob omission described above. |
| Integration tests | No dedicated root or package command. | Missing. |
| Browser tests | No dedicated root or package command. | Missing. |
| Build | `npm run build` | Passed. |
| Database migration | `npm run db:migrate --prefix apps/api` | Confirmed from `apps/api/package.json`; not run because it requires a reachable PostgreSQL instance. `--workspace @arborai/api` is invalid because the root manifest has no npm workspaces. |
| Database seed | `npm run db:seed --prefix apps/api` | Confirmed; not run because it requires PostgreSQL. |
| Database reset (destructive) | `npm run db:reset --prefix apps/api` | Confirmed; not run. |

The current development documentation is inaccurate: the root script runs API from `apps/api`, whose config reads `apps/api/.env`, not a root `.env`. Vite defaults to port 5173, while `.env.example`, API CORS defaults, and local-development documentation use port 3000. The Vite app uses `VITE_API_URL`, not the documented `NEXT_PUBLIC_API_URL`.

## Tickets 01–18 checklist

This is an audit-driven implementation checklist; ticket names can be aligned with the issue tracker before work starts.

- [ ] 01 — Correct knowledge-base documents and local-command/environment documentation.
- [ ] 02 — Establish root scripts for format, unit, integration, browser, database, and benchmark workflows; fix test discovery.
- [ ] 03 — Audit/repair fresh PostgreSQL migration behavior and document compatibility/backfill policy.
- [ ] 04 — Add the remaining additive domain schema: capsules, TreeMaker runs, generations, and snapshots.
- [x] 05 — Implement and test shared runtime schemas, DTOs, discriminated generation requests, and realtime envelopes.
- [ ] 06 — Implement topic/message graph services: ownership, active IDs, cycle prevention, archive/prune, pin, and move.
- [ ] 07 — Implement deterministic context capsules and safe migration/backfill behavior.
- [ ] 08 — Implement the independently tested deterministic Context Engine and context-preview API.
- [ ] 09 — Implement provider abstraction, deterministic mock provider, and validated environment modes.
- [ ] 10 — Implement TreeMaker input, structured decision validation, confidence policy, and fallbacks.
- [ ] 11 — Implement transaction-safe generation lifecycle, snapshots, streaming persistence, and capsule updates.
- [ ] 12 — Implement WebSocket gateway, centralized events, reconnection/deduplication behavior, and tests.
- [ ] 13 — Refactor the React Flow forest and inspectors for all target topic/message states.
- [ ] 14 — Add composer modes, TreeMaker feedback/clarification, context preview, and streaming UI.
- [ ] 15 — Add correction controls: rename, move, archive/restore, prune, context/pin, regenerate, and comparison.
- [ ] 16 — Add mock-mode unit, PostgreSQL integration, browser smoke, and context benchmark coverage.
- [ ] 17 — Add Docker Compose/Dockerfiles and GitHub Actions using mock mode and PostgreSQL service.
- [ ] 18 — Perform end-to-end compatibility review, migration rehearsal, documentation update, and full verification.

## Refactor blockers and technical debt

- Documentation currently claims topic operations, streaming/context behavior, and local setup details that the executable code does not provide.
- API route gating makes current topic handlers unusable.
- The static web server and Vite web app coexist with divergent behavior; tests target both, but users run Vite.
- Configuration is strict mock-only, does not support the target real-provider mode, and disagrees with web port/environment documentation.
- No container/CI baseline exists, so fresh setup and database compatibility are unverified.
- No formatting command exists, and test discovery silently omits some compiled tests.

## Ticket 00 conclusion

No product refactor was started in this ticket. The next ticket is safe to begin after treating this document as the baseline and preserving the documented compatible topic/message separation. The first follow-up should correct documentation and command/test infrastructure before expanding public contracts or the database.
