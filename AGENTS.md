# ArborAI contributor guide

## Read first

Before changing code, read `docs/refactor-spec.md`, `docs/product-model.md`,
`docs/architecture.md`, `docs/tree-maker.md`, `docs/context-rules.md`,
`docs/api-contracts.md`, `docs/realtime-events.md`, `docs/local-development.md`,
and `docs/project-status.md`. Read relevant ADRs in `docs/decisions/` when a
change affects the topic model, context, or routing.

The refactor specification describes the target product. `project-status.md`
records what is actually implemented; do not document a planned capability as
current behavior.

## Product invariants

- A workspace (the current persistence name may be `Conversation`) contains a
  topic forest. Root topics are independent; subtopics use `parentTopicId`.
- A message node belongs to exactly one topic. Message ancestry uses `parentId`
  and is never a substitute for topic hierarchy.
- Alternative assistant responses are sibling assistant message nodes for one
  user message. A normal prompt is not an alternative response.
- TreeMaker only proposes and validates prompt placement. It never answers the
  user, assembles final context, or directly writes arbitrary model output.
- The deterministic Context Engine alone selects model context. Keep it
  independently testable and free of controller, UI, WebSocket, and provider SDK
  dependencies.
- Use compact topic context capsules and immutable generation snapshots. Never
  copy full raw ancestor transcripts into every node or treat snapshots as future
  canonical context.
- Keep credential-free `AI_PROVIDER=mock` working. Provider secrets stay on the
  backend and must never be committed or sent to the frontend.

## Repository conventions

- Use TypeScript. Keep shared DTOs, runtime schemas, enums, and event names in
  `packages/shared/` when both applications use them.
- `apps/web` and `apps/api` may depend on `packages/shared`; shared code must
  not depend on either application.
- Preserve public REST and realtime compatibility. Update schemas,
  documentation, and tests whenever a contract changes.
- Work only on the requested ticket. Avoid dependency replacements, unrelated
  refactors, and speculative features.
- Do not add authentication, billing, RAG, embeddings, uploads, collaborative
  editing, or cloud deployment unless the ticket explicitly requires them.

## Verification

Every behavior change needs the nearest relevant tests. From the repository
root, run the applicable commands before handoff:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Use documented database commands only with a configured local PostgreSQL
instance. State exactly which commands were run and their results; never claim
unrun checks passed.
