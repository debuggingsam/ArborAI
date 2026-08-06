# ADR 001: Topic-aware workspace

Topics are first-class records because subject hierarchy and message ancestry represent different relationships. `parentId` remains useful for reconstructing a message path and alternative responses inside one topic. Context exclusion is separate from deletion so users can change model context without losing visible history. ArborAI remains independent from Codex and does not depend on Codex internals. Independent root topics are isolated by default to prevent unrelated subjects entering model context.
