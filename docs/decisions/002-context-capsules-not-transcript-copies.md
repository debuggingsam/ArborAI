# ADR 002: Context capsules, not transcript copies

## Decision

Use bounded topic context capsules plus immutable per-generation context
snapshots instead of copying raw root-to-node transcripts into every new
message. Capsules record concise durable knowledge and source IDs; snapshots
record exactly what was sent historically.

## Consequences

Subtopics can inherit compressed lineage understanding while raw messages stay
canonical in their original nodes. This prevents storage growth, stale copied
context, and accidental inclusion of unrelated branches. A snapshot is never a
source for future context; the deterministic Context Engine re-evaluates current
capsules, enabled state, selected path, and token budget each generation.

Capsules must be schema-validated, bounded, deduplicated, and free of provider
credentials or other secrets.
