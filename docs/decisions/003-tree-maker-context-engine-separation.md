# ADR 003: TreeMaker and Context Engine separation

## Decision

Keep TreeMaker, the deterministic Context Engine, and the answering model as
separate responsibilities. TreeMaker emits a validated placement proposal;
the Context Engine deterministically selects context; the answering provider
generates the user-facing response.

## Consequences

TreeMaker cannot directly write arbitrary model output, select unrelated
context, or generate the answer. Its input stays compact and its decision is
persisted for debugging. The Context Engine is independently testable and does
not depend on HTTP, UI, WebSocket, or provider SDK types. The same engine powers
context preview and actual generation, yielding inspectable exclusions, warnings,
and token-budget behavior.
