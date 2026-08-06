# ADR 001: Topic-aware workspace

## Decision

Model ArborAI as a workspace containing a forest of first-class topics and
separate per-topic message trees. A root topic is an independent subject;
subtopics use `parentTopicId`. Messages use `parentId` only for conversational
branching, and every message has one owning `topicId`.

## Consequences

Alternative assistant answers are sibling assistant messages, not topic
structure. Independent root topics and sibling subtopics are isolated from
default context. Context exclusion, archive, and pruning remain distinct and
reversible lifecycle concepts. The temporary persistence name `Conversation`
is compatible with the product term workspace and need not trigger a cosmetic
migration.

This avoids incorrectly presenting ArborAI as only an alternative-response
tree and enables automatic topic routing without losing message-path fidelity.
