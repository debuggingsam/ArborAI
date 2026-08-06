# TreeMaker

TreeMaker is ArborAI's routing agent. It organizes a new prompt; it does not
answer it. The deterministic Context Engine later determines the actual answer
context.

## Input and actions

TreeMaker receives a compact workspace tree index: workspace ID/title, active
topic/node, visible topic IDs/parents/titles/descriptions/capsule summaries,
recent activity, context/archive state, bounded recent message previews, and
the new prompt. It must not receive every raw message in the workspace.

It returns exactly one validated action:

- `continue_topic(topicId, anchorNodeId)` for a direct follow-up or coherent
  extension;
- `create_subtopic(parentTopicId, title, description, provisionalCapsule)` for
  a distinct concern that belongs under an existing subject;
- `create_root_topic(title, description, provisionalCapsule)` for a materially
  unrelated subject; or
- `ask_user(question, suggestedTopicIds)` only when placement ambiguity would
  materially change context.

Each decision includes `confidence` from 0 to 1 and a concise reasoning
summary. IDs must come from the supplied input. Archived topics are never normal
candidates; disabled topics are excluded by default.

## Confidence policy

| Confidence | Behavior |
| --- | --- |
| `>= 0.85` | Apply automatically, show a non-blocking placement notice and undo/move control. |
| `0.55–<0.85` | Apply by default, show prominent placement feedback and quick move actions. |
| `< 0.55` | Return `ask_user`; do not create a topic or generation automatically. |

Thresholds are configurable. Mock mode uses deterministic decisions and
confidence so tests need no credentials.

## Validation and fallback

The service validates schema, confidence range, referenced topic/node
existence/ownership, archive state, anchor membership, title constraints, and
topic-cycle safety before mutation. Structured provider output is required;
never parse arbitrary prose with string matching.

If validation or the provider fails, record the failed/fallback run and retain
the user's prompt. Continue the active topic when one exists; otherwise create
a safely prompt-derived root topic. TreeMaker never directly disables,
archives, prunes, moves unrelated topics, changes relationships, or writes a
user-facing assistant response.
