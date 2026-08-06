# Context rules

The deterministic Context Engine, not TreeMaker, decides the answering-model
payload. It is used identically for preview and generation.

## Selection order

For `{ workspaceId, topicId, anchorNodeId, newPrompt, maxInputTokens }`, build
context in this order:

1. Workspace system prompt.
2. Enabled root-to-active-topic capsules.
3. Enabled pinned messages from that topic lineage.
4. Enabled selected message path in the active topic.
5. The new prompt exactly once.

The engine detects topic and message cycles and rejects cross-workspace parent
references. It returns messages, included/excluded topic and node IDs,
exclusions, warnings, trimmed node IDs, and an estimated token count.

## Lineage and branch isolation

- Only the active topic's root-to-topic lineage is eligible. Independent root
  topics, sibling topics, and sibling subtopics are excluded.
- In the active topic, start at the anchor and follow `parentId` to the topic
  root, reverse the path, and include only that path.
- Unselected assistant alternatives and other sibling message branches are
  excluded. Topics and messages remain visible despite exclusion.
- Pinned messages are additional explicit context only when they belong to the
  selected topic lineage. Disabled or pruned pins remain excluded and a pin is
  not duplicated if it is already on the selected path.

## Context state and lifecycle

An archived topic is absent from normal graph/context results. A topic with
`contextEnabled=false` remains visible but contributes neither capsule nor raw
messages; all descendants are effectively inherited-disabled. A generation may
not target an effectively disabled topic until it is re-enabled or another
topic is selected.

A disabled individual message is omitted but remains visible. Enabled later
descendants stay eligible, with a `context_gap` warning when omission makes the
path incomplete. Pruned nodes are stored but omitted from normal graph and
context queries.

## Token budgets and warnings

Token estimation is behind a provider-independent estimator. On a budget limit,
preserve the system prompt, lineage capsules, new prompt, and newest active
topic messages; remove oldest removable raw message pairs first. Return all
trimmed IDs with `token_budget` exclusions. If required content cannot fit,
return actionable `token_budget_too_small` rather than silently exceeding the
limit.

Stable exclusion reasons are `unrelated_root_topic`, `sibling_topic`,
`topic_context_disabled`, `ancestor_topic_context_disabled`, `topic_archived`,
`alternative_branch_not_selected`, `message_context_disabled`,
`message_pruned`, and `token_budget`.

Stable warnings are `context_gap`, `missing_active_node`,
`invalid_parent_reference`, `capsule_missing`, and `token_budget_too_small`.
