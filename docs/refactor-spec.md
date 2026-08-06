# ArborAI Full Refactor Specification

## 1. Instruction to Codex

Refactor the existing ArborAI repository to conform to this specification.

This document is the product and technical source of truth. Inspect the current repository before making changes. Preserve completed Day 1 and Day 2 work where it remains compatible, but replace assumptions that ArborAI is only an alternative-response conversation tree.

The final application must work in two modes:

1. **Mock mode**

    * Requires no external credentials.
    * Supports deterministic TreeMaker decisions.
    * Supports deterministic streamed assistant responses.
    * Supports local development, automated testing, and demos.

2. **Real-provider mode**

    * Activated through environment variables.
    * Requires only valid provider credentials and model names.
    * Uses the same application workflows as mock mode.
    * Must not require source-code changes.

Do not stop after only changing documentation or database models. Complete the full vertical workflow:

```text id="j26n63"
User submits prompt
→ TreeMaker classifies the prompt
→ Topic or subtopic is selected or created
→ Context is assembled
→ Answering model streams a response
→ Graph updates in real time
→ Final response and generation snapshot are persisted
→ Topic context capsule is updated
```

Before finishing, run all available formatting, lint, type-checking, unit-test, integration-test, browser-test, build, database-migration, and Docker verification commands.

Do not claim a command passed unless it was actually executed.

---

# 2. Product Definition

ArborAI is a visual AI knowledge workspace that automatically organizes conversations into:

* Independent root topics.
* Nested subtopics.
* Message threads.
* Alternative assistant responses.
* Explicitly included or excluded context.

The user should not need to manually decide the location of every prompt.

When a new prompt arrives, ArborAI sends a compact representation of the current topic tree and the new prompt to a specialized **TreeMaker agent**.

TreeMaker decides whether the prompt should:

1. Continue an existing topic.
2. Create a new subtopic under an existing topic.
3. Create a new independent root topic.
4. Request clarification when placement is genuinely ambiguous.

After placement, ArborAI deterministically assembles the context needed by the answering model.

The answering model produces the actual user-facing response.

## 2.1 Primary Product Principle

TreeMaker controls **organization**.

The Context Engine controls **what information is sent**.

The Answering Agent controls **the response**.

These responsibilities must remain separated.

TreeMaker must not directly generate the final user-facing answer.

## 2.2 Normal Interaction Example

```text id="zzxk6r"
Workspace: ArborAI Development
│
├── Topic: Authentication
│   │
│   ├── User: How should authentication work?
│   ├── Assistant: Use short-lived access tokens...
│   │
│   ├── Subtopic: Refresh-token storage
│   │   ├── User: Should refresh tokens use cookies?
│   │   └── Assistant: HTTP-only cookies are preferable...
│   │
│   └── Subtopic: Password reset
│       ├── User: How should reset links expire?
│       └── Assistant: ...
│
└── Topic: Docker deployment
    ├── User: How should I containerize this?
    └── Assistant: ...
```

The Docker topic must not be included when the user asks a follow-up inside the refresh-token subtopic.

## 2.3 Alternative Response Example

Alternative responses are supported only when the user explicitly requests regeneration or another answer:

```text id="at0zel"
User: Should refresh tokens use cookies?
├── Assistant response A
└── Assistant response B
```

A normal new prompt must not automatically become an alternative response.

## 2.4 Product Terminology

Use these terms consistently:

### Workspace

The top-level ArborAI environment containing topics, messages, settings, and generations.

If the current database already uses `Conversation`, it may remain the database/model name to avoid a risky cosmetic migration. In product copy and documentation, treat it as a workspace.

### Topic

A subject within a workspace.

A topic can be:

* A root topic with no parent.
* A subtopic with a parent topic.
* Context-enabled.
* Context-excluded.
* Archived.

### Message Node

A user or assistant message belonging to exactly one topic.

Message nodes can form a branch using `parentId`.

### Topic Context Capsule

A compact, self-contained representation of the important knowledge associated with a topic.

A context capsule is not a copy of every ancestor message.

### Generation

One complete model-generation operation, including:

* Placement decision.
* User message.
* Assistant message.
* Context snapshot.
* Model configuration.
* Token usage.
* Completion or error state.

### Generation Snapshot

An immutable record of exactly what was sent to the answering model for a historical generation.

---

# 3. Critical Architectural Decision: Self-Contained Context

The original concept proposes storing all root-to-node context inside every new node.

Do not duplicate the full raw ancestor transcript inside every message record.

Instead, implement self-contained behavior using two mechanisms:

## 3.1 Topic Context Capsules

Every topic stores a compact context capsule containing the knowledge required to understand that topic.

For example:

```json id="wq5xf0"
{
  "summary": "The application uses a NestJS authentication API with short-lived access tokens.",
  "facts": [
    "The frontend is built with Next.js.",
    "Access tokens expire after 15 minutes."
  ],
  "decisions": [
    "Refresh tokens will be stored in HTTP-only cookies."
  ],
  "constraints": [
    "Authentication must work without OAuth."
  ],
  "openQuestions": [
    "Should refresh-token rotation occur on every use?"
  ],
  "sourceTopicIds": ["topic-authentication"],
  "sourceNodeIds": ["node-101", "node-102"]
}
```

A subtopic capsule must be understandable without reading the entire ancestor transcript.

It may inherit and compress information from ancestor-topic capsules.

## 3.2 Immutable Generation Snapshots

Every completed or attempted generation stores the exact context sent to the answering model.

This preserves:

* Debuggability.
* Reproducibility.
* Benchmarking.
* Auditing.
* Exact token accounting.
* Historical behavior after context settings change.

The snapshot is historical evidence. It must not automatically become the context source for future prompts.

## 3.3 Canonical Data

Canonical facts remain in:

* Topics.
* Topic context capsules.
* Message nodes.
* Workspace configuration.

Do not treat copied transcript text as canonical.

---

# 4. High-Level System Architecture

Use the repository’s existing stack:

```text id="0lyyxh"
Frontend
- Next.js
- TypeScript
- React Flow
- WebSocket client

Backend
- NestJS
- TypeScript
- REST API
- WebSocket gateway
- Provider adapters

Persistence
- PostgreSQL
- Existing ORM, preferably Prisma if already configured

Infrastructure
- Docker
- Docker Compose
- GitHub Actions

Shared Package
- DTOs
- Runtime schemas
- Event names
- Enums
- Discriminated unions
```

## 4.1 Required Backend Components

Create or refactor toward these logical modules:

```text id="bpi8c5"
WorkspaceModule
TopicModule
MessageNodeModule
TreeMakerModule
ContextEngineModule
ContextCapsuleModule
GenerationModule
AiProviderModule
RealtimeModule
HealthModule
```

Equivalent naming is acceptable when the responsibilities remain separated.

## 4.2 Dependency Direction

Use this dependency direction:

```text id="3e64ms"
Controllers / WebSocket Gateway
            ↓
Application Services
            ↓
Domain Services
            ↓
Repositories / Provider Adapters
```

The context engine must not depend on:

* HTTP controllers.
* React code.
* Provider-specific SDK types.
* WebSocket implementation details.

TreeMaker must not directly write unvalidated model output into the database.

---

# 5. Domain Model

Adapt field names to the existing ORM conventions, but preserve these semantics.

## 5.1 Workspace or Conversation

```ts id="kjokis"
interface Workspace {
  id: string;
  title: string;
  systemPrompt: string | null;
  activeTopicId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Rules:

* `activeTopicId` must belong to the workspace.
* Deleting a workspace may delete its owned topics, messages, and generations.
* Workspace deletion must be explicit and destructive.
* Topic context exclusion must not modify the workspace system prompt.

## 5.2 Topic

```ts id="sqszie"
interface Topic {
  id: string;
  workspaceId: string;
  parentTopicId: string | null;

  title: string;
  description: string | null;

  contextEnabled: boolean;
  archivedAt: Date | null;

  activeNodeId: string | null;

  contextCapsule: TopicContextCapsule | null;
  capsuleVersion: number;
  capsuleUpdatedAt: Date | null;

  createdBy: "user" | "tree_maker" | "migration";
  createdAt: Date;
  updatedAt: Date;
}
```

Rules:

* A root topic has `parentTopicId = null`.
* A subtopic’s parent must belong to the same workspace.
* A topic cannot be its own ancestor.
* Topic cycles must be detected and rejected.
* `activeNodeId`, when present, must reference a visible message belonging to the topic.
* Archiving a topic excludes it from context.
* Context exclusion does not archive or hide it.
* A disabled ancestor topic produces an inherited exclusion for descendant topics.

## 5.3 Topic Context Capsule

Store as JSON or normalized fields. JSON is acceptable for the MVP.

```ts id="2365p0"
interface TopicContextCapsule {
  summary: string;
  facts: string[];
  decisions: string[];
  constraints: string[];
  openQuestions: string[];

  sourceTopicIds: string[];
  sourceNodeIds: string[];

  generatedBy: "mock" | "model" | "manual";
  model: string | null;
  generatedAt: string;
}
```

Requirements:

* Keep arrays reasonably bounded.
* Deduplicate repeated facts and decisions.
* Do not place secrets or provider credentials in a capsule.
* Preserve source IDs for explainability.
* Capsule updates must be validated against a runtime schema.
* A model-generated capsule may never change topic relationships.

## 5.4 Message Node

```ts id="nybrb7"
type MessageRole = "user" | "assistant";

type MessageStatus =
  | "pending"
  | "streaming"
  | "completed"
  | "error";

interface MessageNode {
  id: string;
  workspaceId: string;
  topicId: string;
  parentId: string | null;

  role: MessageRole;
  content: string;
  status: MessageStatus;

  contextEnabled: boolean;
  pinned: boolean;

  tokenCount: number | null;
  errorMessage: string | null;

  prunedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}
```

Rules:

* A message belongs to one workspace and one topic.
* A message parent must belong to the same workspace and topic.
* Root messages inside a topic have `parentId = null`.
* Multiple assistant nodes may share the same user parent.
* A normal assistant response is a child of the user message.
* A normal follow-up user message is a child of the selected assistant response.
* Pruned nodes remain stored but do not appear in normal context or normal graph queries.
* A streaming node cannot be pruned.
* Assistant nodes may be in `error` state.
* User nodes should normally be persisted as `completed`.

## 5.5 TreeMaker Run

Persist each TreeMaker decision for debugging.

```ts id="6envew"
interface TreeMakerRun {
  id: string;
  workspaceId: string;

  newPrompt: string;
  activeTopicId: string | null;
  activeNodeId: string | null;

  inputTreeIndex: unknown;
  outputDecision: TreeMakerDecision;

  provider: string;
  model: string;
  confidence: number;

  status: "completed" | "failed" | "fallback";
  errorMessage: string | null;

  createdAt: Date;
}
```

The stored input may be truncated if necessary, but enough information should remain to debug the decision.

## 5.6 Generation

```ts id="phuc8h"
interface Generation {
  id: string;
  workspaceId: string;
  topicId: string;

  treeMakerRunId: string | null;

  userNodeId: string;
  assistantNodeId: string;

  mode:
    | "auto_route"
    | "manual_continue"
    | "manual_subtopic"
    | "manual_root_topic"
    | "regenerate";

  provider: string;
  model: string;

  status:
    | "pending"
    | "streaming"
    | "completed"
    | "error";

  inputTokenCount: number | null;
  outputTokenCount: number | null;

  errorMessage: string | null;

  startedAt: Date;
  completedAt: Date | null;
}
```

## 5.7 Generation Context Snapshot

```ts id="fw58pf"
interface GenerationContextSnapshot {
  id: string;
  generationId: string;

  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
    sourceType:
      | "workspace_system_prompt"
      | "topic_capsule"
      | "message_node"
      | "new_prompt";
    sourceId: string | null;
  }>;

  includedTopicIds: string[];
  includedNodeIds: string[];

  excludedTopicIds: string[];
  excludedNodeIds: string[];

  exclusions: ContextExclusion[];
  warnings: ContextWarning[];

  estimatedInputTokens: number;
  maxInputTokens: number | null;

  createdAt: Date;
}
```

The snapshot must be written before or at the start of provider generation.

---

# 6. TreeMaker Agent

## 6.1 Responsibility

TreeMaker receives:

* A compact current-tree representation.
* The workspace’s active topic.
* The currently selected message, when applicable.
* The new user prompt.
* Available placement actions.

It returns a structured placement decision.

TreeMaker does not:

* Generate the user-facing answer.
* Modify the database directly.
* Disable context.
* Archive content.
* Prune content.
* Move unrelated existing topics.
* Select arbitrary node IDs that were not present in its input.

## 6.2 TreeMaker Actions

```ts id="sz98yt"
type TreeMakerDecision =
  | {
      action: "continue_topic";
      topicId: string;
      anchorNodeId: string | null;
      confidence: number;
      reasoningSummary: string;
      proposedTitle: null;
      proposedDescription: null;
      provisionalCapsule: TopicContextCapsule | null;
    }
  | {
      action: "create_subtopic";
      parentTopicId: string;
      title: string;
      description: string | null;
      confidence: number;
      reasoningSummary: string;
      provisionalCapsule: TopicContextCapsule;
    }
  | {
      action: "create_root_topic";
      title: string;
      description: string | null;
      confidence: number;
      reasoningSummary: string;
      provisionalCapsule: TopicContextCapsule;
    }
  | {
      action: "ask_user";
      question: string;
      suggestedTopicIds: string[];
      confidence: number;
      reasoningSummary: string;
    };
```

## 6.3 When to Continue a Topic

Choose `continue_topic` when:

* The new prompt is a direct follow-up.
* It relies on entities or decisions from the topic.
* It asks for clarification, elaboration, modification, or application of the same subject.
* Creating a new topic would fragment one coherent discussion.

Example:

```text id="grskre"
Existing topic:
Refresh-token storage

New prompt:
Should I rotate them after every use?
```

Decision:

```json id="g9mnl8"
{
  "action": "continue_topic",
  "topicId": "topic-refresh-tokens",
  "anchorNodeId": "assistant-latest",
  "confidence": 0.96
}
```

## 6.4 When to Create a Subtopic

Choose `create_subtopic` when:

* The prompt belongs under an existing subject.
* It introduces a distinct concern that may have its own follow-ups.
* The new discussion should inherit parent knowledge but remain separately navigable.

Example:

```text id="dz0iwd"
Existing topic:
Authentication

New prompt:
How should password reset links expire?
```

Decision:

```json id="r70nzx"
{
  "action": "create_subtopic",
  "parentTopicId": "topic-authentication",
  "title": "Password reset links",
  "confidence": 0.91
}
```

## 6.5 When to Create a Root Topic

Choose `create_root_topic` when:

* The prompt is materially unrelated to all current topics.
* It should not inherit context from an existing root.
* It begins a new subject.

Example:

```text id="r3m9fe"
Current tree:
Authentication
Database design

New prompt:
Help me prepare for a behavioral interview.
```

Decision:

```json id="xpiyxa"
{
  "action": "create_root_topic",
  "title": "Behavioral interview preparation",
  "confidence": 0.98
}
```

## 6.6 When to Ask the User

Use `ask_user` sparingly.

Choose it only when:

* Two or more placements are genuinely plausible.
* The ambiguity affects what context should be sent.
* The prompt cannot safely be treated as a continuation of the active topic.

Example:

```text id="v4skhi"
New prompt:
How should I deploy that?
```

Question:

```text id="fq8mq9"
Should this go under ArborAI deployment or the authentication-service topic?
```

## 6.7 Confidence Policy

Implement configurable confidence thresholds:

```text id="55658i"
High confidence:
confidence >= 0.85

Medium confidence:
0.55 <= confidence < 0.85

Low confidence:
confidence < 0.55
```

Behavior:

### High Confidence

* Apply automatically.
* Show a non-blocking placement notification.
* Allow undo or move.

### Medium Confidence

* Apply automatically by default.
* Show a prominent placement notification.
* Include quick actions to move to another suggested location.
* The threshold should be configurable.

### Low Confidence

* Do not create a topic or generation automatically.
* Return an `ask_user` result.
* Display placement choices.

In mock mode, make confidence deterministic.

## 6.8 TreeMaker Input

Do not send every raw message from the entire workspace on every request.

Send a compact tree index:

```ts id="zvsj6i"
interface TreeMakerInput {
  workspace: {
    id: string;
    title: string;
  };

  activeTopicId: string | null;
  activeNodeId: string | null;

  topics: Array<{
    id: string;
    parentTopicId: string | null;
    title: string;
    description: string | null;

    capsuleSummary: string | null;
    recentActivity: string | null;

    contextEnabled: boolean;
    archived: boolean;

    childTopicCount: number;
    messageCount: number;
  }>;

  recentMessagesByTopic: Record<
    string,
    Array<{
      id: string;
      role: "user" | "assistant";
      contentPreview: string;
    }>
  >;

  newPrompt: string;
}
```

Requirements:

* Exclude archived topics from normal candidate placement.
* Include context-disabled topics as placement candidates only if product settings allow it. By default, TreeMaker should not route new prompts into disabled topics.
* Limit recent messages per topic.
* Truncate long previews.
* Include full topic capsules only for the most relevant or active topics.
* Validate all input and output with runtime schemas.

For the MVP, every visible topic may be included if the tree remains reasonably small.

## 6.9 TreeMaker System Prompt

Use a system prompt equivalent to:

```text id="y61owb"
You are TreeMaker, the topic-routing agent for ArborAI.

Your responsibility is to decide where a newly arrived user prompt belongs in
an existing topic tree.

You must return exactly one structured action:
- continue_topic
- create_subtopic
- create_root_topic
- ask_user

Definitions:

A root topic is an independent subject that should not inherit context from
other root topics.

A subtopic is a distinct concern that belongs under an existing subject and
should inherit compact context from its parent-topic lineage.

Continue an existing topic when the prompt is a direct follow-up, clarification,
extension, revision, or application of the same subject.

Create a subtopic when the prompt relates to an existing topic but introduces
a distinct concern likely to have its own follow-up discussion.

Create a root topic when the prompt is materially unrelated to existing topics.

Ask the user only when placement ambiguity would materially change the context
used to answer.

Rules:
- Never invent topic IDs.
- Never select archived topics.
- Prefer the current active topic when the prompt clearly depends on it.
- Do not create unnecessary subtopics for small follow-up questions.
- Do not group unrelated subjects under one topic.
- Keep proposed titles concise and specific.
- Return a confidence value from 0 to 1.
- Return only data matching the required output schema.
- Do not answer the user's actual question.
- Do not modify, archive, disable, merge, or delete existing topics.
```

Provider-native structured output or tool calling should be used when available.

Never parse free-form TreeMaker prose with fragile string operations.

## 6.10 TreeMaker Validation

After receiving a decision:

1. Validate the schema.
2. Confirm referenced topic IDs exist.
3. Confirm referenced topics belong to the workspace.
4. Confirm referenced topics are not archived.
5. Confirm anchor nodes belong to the selected topic.
6. Confirm confidence is between 0 and 1.
7. Reject cyclic topic placement.
8. Sanitize or constrain generated titles.
9. Apply a safe fallback on failure.

Fallback behavior:

* When an active topic exists, fall back to `continue_topic` with a recorded fallback status.
* When no active topic exists, fall back to `create_root_topic` using a title derived from the first several prompt words.
* Never lose the user’s submitted prompt because TreeMaker failed.

---

# 7. Context Capsule System

## 7.1 Purpose

The capsule makes a topic self-contained without copying every ancestor message.

A child topic capsule should contain enough inherited context to understand:

* What the parent discussion is about.
* Important facts.
* Decisions already made.
* Relevant constraints.
* Open questions affecting the subtopic.

## 7.2 Capsule Creation

For a new root topic:

```text id="smu9sv"
Capsule inputs:
- New user prompt
- Workspace-level instructions
```

For a new subtopic:

```text id="2q9s2a"
Capsule inputs:
- Parent-topic capsule
- Relevant ancestor capsule summaries
- New user prompt
```

For continuing an existing topic:

* Do not rewrite the capsule before every answer.
* Use the existing capsule for context.
* Update the capsule after a successful response when the exchange adds meaningful knowledge.

## 7.3 Capsule Update Agent

A separate logical operation may use the same provider infrastructure.

Input:

```ts id="y8u27x"
interface CapsuleUpdateInput {
  existingCapsule: TopicContextCapsule | null;
  topicTitle: string;
  topicDescription: string | null;
  userPrompt: string;
  assistantResponse: string;
}
```

Output:

```ts id="n931p4"
interface CapsuleUpdateOutput {
  capsule: TopicContextCapsule;
  changed: boolean;
}
```

The update operation should:

* Preserve valid existing facts.
* Add new decisions and constraints.
* Remove resolved open questions.
* Avoid storing conversational filler.
* Avoid storing the complete response.
* Avoid speculative facts unless labeled as unresolved.
* Deduplicate entries.
* Keep the summary concise.

## 7.4 Capsule Update Prompt

Use a prompt equivalent to:

```text id="ud84o1"
You maintain a compact context capsule for one ArborAI topic.

Update the capsule using the latest user prompt and assistant response.

The capsule must preserve durable information needed for future questions:
- summary
- facts
- decisions
- constraints
- open questions

Do not copy the full conversation.
Do not include greetings, filler, or repeated explanations.
Do not turn suggestions into confirmed decisions unless the conversation did so.
Remove open questions that were clearly resolved.
Keep the capsule concise and self-contained.
Return only data matching the required schema.
```

## 7.5 Mock Capsule Behavior

Mock mode should produce deterministic capsule content.

It does not need sophisticated semantic summarization, but it must:

* Create a stable summary.
* Include deterministic source IDs.
* Demonstrate capsule persistence and updates.
* Support automated tests.

## 7.6 Capsule Failure

A capsule-update failure must not fail or erase an otherwise successful assistant response.

When capsule updating fails:

* Mark the capsule update as failed in logs.
* Keep the existing capsule.
* Allow manual retry.
* Do not mark the generation as failed.

---

# 8. Deterministic Context Engine

## 8.1 Responsibility

The context engine decides what is sent to the answering model.

It must be deterministic and independently testable.

TreeMaker may suggest placement, but TreeMaker must not decide the final context payload.

## 8.2 Required Interface

```ts id="rvysqh"
interface AssembleContextInput {
  workspaceId: string;
  topicId: string;
  anchorNodeId: string | null;
  newPrompt: string;
  maxInputTokens: number | null;
}

interface AssembleContextResult {
  messages: ModelMessage[];

  includedTopicIds: string[];
  includedNodeIds: string[];

  excludedTopicIds: string[];
  excludedNodeIds: string[];

  exclusions: ContextExclusion[];
  warnings: ContextWarning[];

  trimmedNodeIds: string[];

  estimatedTokenCount: number;
}
```

## 8.3 Context Ordering

The answering-model context should be assembled in this order:

```text id="lk69ls"
1. Workspace system prompt
2. Root-to-active-topic context capsules
3. Pinned enabled messages from the relevant topic lineage
4. Enabled selected message path inside the active topic
5. New user prompt
```

Do not include the new prompt twice.

## 8.4 Topic Lineage

Resolve:

```text id="5fezz1"
root topic
→ child topic
→ nested child topic
→ active topic
```

Requirements:

* Detect cycles.
* Reject cross-workspace parent references.
* Exclude archived topics.
* Exclude unrelated root topics.
* Exclude sibling topics.
* Exclude sibling subtopics.

## 8.5 Topic Context State

When a topic has `contextEnabled = false`:

* Exclude its capsule.
* Exclude its raw messages.
* Exclude descendant-topic capsules.
* Exclude descendant-topic raw messages.
* Display descendant topics as inherited-disabled.

A generation must not automatically proceed inside an effectively disabled topic.

The user must re-enable the topic or choose another target.

## 8.6 Message Path

Within the selected topic:

1. Start from `anchorNodeId`.
2. Follow `parentId` to the root message of that topic.
3. Detect cycles.
4. Reverse into chronological order.
5. Include only that path.
6. Exclude sibling message branches.
7. Exclude unselected alternative assistant responses.
8. Exclude pruned messages.
9. Exclude individually disabled messages.
10. Include pinned messages according to the separate pinned-message rule.

## 8.7 Disabled Individual Messages

When an individual message is disabled:

* Omit that message.
* Keep it visible in the graph.
* Permit later enabled descendants to remain included.
* Return a `context_gap` warning when descendants depend on omitted content.

The UI should explain that excluding a message may make later content harder for the model to understand.

## 8.8 Pinned Messages

Pinned messages are explicit context items.

Rules:

* A pinned message must belong to the selected topic lineage.
* Pinned messages from unrelated root topics must not be included automatically.
* A disabled or pruned pinned message remains excluded.
* Prevent duplicate inclusion when a pinned message already exists on the selected path.

## 8.9 Stable Exclusion Codes

```ts id="i5rbo5"
type ContextExclusionReason =
  | "unrelated_root_topic"
  | "sibling_topic"
  | "topic_context_disabled"
  | "ancestor_topic_context_disabled"
  | "topic_archived"
  | "alternative_branch_not_selected"
  | "message_context_disabled"
  | "message_pruned"
  | "token_budget";
```

## 8.10 Stable Warning Codes

```ts id="dwbjtb"
type ContextWarningCode =
  | "context_gap"
  | "missing_active_node"
  | "invalid_parent_reference"
  | "capsule_missing"
  | "token_budget_too_small";
```

## 8.11 Token Budget

Put token estimation behind an interface:

```ts id="9puh3t"
interface TokenEstimator {
  estimateText(text: string): number;
  estimateMessages(messages: ModelMessage[]): number;
}
```

If the selected context exceeds the configured limit:

1. Preserve the workspace system prompt.
2. Preserve the topic-lineage capsules.
3. Preserve the new prompt.
4. Preserve the newest active-topic messages.
5. Remove the oldest removable raw message pairs first.
6. Return all trimmed node IDs.
7. Never silently exceed the limit.
8. Return an actionable error when even required content cannot fit.

## 8.12 Context Preview

The backend must expose the exact context result before generation.

The frontend must show:

* Included capsules.
* Included raw messages.
* Excluded topics.
* Excluded messages.
* Exclusion reasons.
* Context warnings.
* Estimated tokens.
* Trimmed messages.
* System-prompt presence.

The context preview and actual generation must use the same context-engine code.

---

# 9. Prompt Submission Modes

## 9.1 Auto Route

This is the default.

```text id="h8t7ih"
User enters prompt
→ TreeMaker chooses placement
→ Application validates placement
→ Topic is selected or created
→ Context is assembled
→ Answer is generated
```

## 9.2 Manual Continue

The user explicitly selects an existing topic and message anchor.

TreeMaker is bypassed for placement.

A TreeMaker run does not need to be created.

## 9.3 Manual New Subtopic

The user explicitly chooses a parent topic and optionally provides a title.

TreeMaker placement is bypassed.

The capsule may still be generated using the capsule system.

## 9.4 Manual New Root Topic

The user explicitly begins an independent topic.

No existing topic context is inherited.

## 9.5 Regenerate

The user selects an existing user message and requests another answer.

Rules:

* Do not create a second user node.
* Create a new assistant node with the same user parent.
* Use the context path ending at the selected user node.
* Mark the new assistant as the active branch after completion.
* Do not call TreeMaker.

---

# 10. Generation Lifecycle

## 10.1 Auto-Route Lifecycle

Use this sequence:

```text id="tko19f"
1. Receive prompt
2. Validate workspace and input
3. Build compact TreeMaker input
4. Run TreeMaker
5. Validate TreeMaker decision
6. Ask user if low-confidence clarification is required
7. Create or select topic
8. Create user message
9. Create empty streaming assistant message
10. Set active topic and active node
11. Assemble deterministic context
12. Persist immutable context snapshot
13. Begin answering-provider stream
14. Broadcast text deltas
15. Persist final response
16. Persist usage
17. Mark generation completed
18. Update topic capsule
19. Broadcast completion
```

## 10.2 Transaction Boundaries

Use a transaction for initial graph writes:

* Topic creation when required.
* User-node creation.
* Assistant-node creation.
* Generation creation.
* Active-topic update.
* Active-node update.

Do not keep a database transaction open during the model stream.

## 10.3 Failure Before Streaming

If TreeMaker fails:

* Use documented fallback behavior.
* Record the fallback.

If database setup fails:

* Do not call the answering model.
* Return a useful error.
* Preserve the user’s typed text in the frontend.

If context assembly fails:

* Mark the assistant node as `error`.
* Mark the generation as `error`.
* Broadcast failure.

## 10.4 Failure During Streaming

When a provider stream fails:

* Preserve any received partial content.
* Set assistant status to `error`.
* Set generation status to `error`.
* Store a sanitized error message.
* Broadcast `assistant.failed`.
* Provide a retry action.

Never leave a generation permanently marked as streaming.

## 10.5 Completion

On completion:

* Persist final assistant content.
* Persist input/output token usage when available.
* Set assistant status to `completed`.
* Set generation status to `completed`.
* Update the topic active node.
* Broadcast completion.
* Trigger capsule updating.

---

# 11. AI Provider Abstraction

## 11.1 Required Interface

```ts id="f2nrrh"
interface AiProvider {
  streamAnswer(input: {
    model: string;
    messages: ModelMessage[];
    generationId: string;
    signal?: AbortSignal;
  }): AsyncIterable<AiStreamEvent>;

  createStructuredOutput<T>(input: {
    model: string;
    systemPrompt: string;
    payload: unknown;
    schema: RuntimeSchema<T>;
    signal?: AbortSignal;
  }): Promise<T>;
}
```

## 11.2 Stream Events

```ts id="06vwot"
type AiStreamEvent =
  | {
      type: "text_delta";
      delta: string;
    }
  | {
      type: "usage";
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | {
      type: "completed";
    };
```

Provider errors should be thrown as normalized application errors.

## 11.3 Required Providers

Implement:

```text id="ly5xg5"
MockAiProvider
OpenAiProvider or existing selected real provider
```

Use the repository’s chosen supported official SDK.

Do not leak provider-specific types into:

* Shared DTOs.
* Database models.
* Context engine.
* React components.

## 11.4 Mock Provider

The mock provider must:

* Require no network.
* Stream deterministic chunks.
* Return deterministic usage.
* Support configurable delay.
* Support forced TreeMaker actions in tests.
* Simulate provider failure.
* Simulate malformed structured output.
* Simulate interrupted answer streams.
* Support deterministic capsule updates.

## 11.5 Environment Variables

Create a complete `.env.example`.

Use variables equivalent to:

```text id="l7cqqv"
NODE_ENV=development

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/arborai

WEB_ORIGIN=http://localhost:3000
API_PORT=3001
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=http://localhost:3001

AI_PROVIDER=mock

ANSWER_MODEL=
TREE_MAKER_MODEL=
CAPSULE_MODEL=

OPENAI_API_KEY=

TREE_MAKER_HIGH_CONFIDENCE=0.85
TREE_MAKER_LOW_CONFIDENCE=0.55

MAX_INPUT_TOKENS=
TREE_MAKER_MAX_TOPICS=
TREE_MAKER_RECENT_MESSAGES_PER_TOPIC=3

MOCK_STREAM_DELAY_MS=40
MOCK_FORCE_FAILURE=false
```

Requirements:

* Mock mode must not require blank fake secrets.
* Real-provider mode must fail fast when required credentials are missing.
* Never expose secret keys to the frontend.
* Validate configuration at backend startup.

---

# 12. REST API

Adapt route prefixes to existing conventions, but provide equivalent behavior.

## 12.1 Health

```text id="xam5ij"
GET /health
```

Returns API and database health.

## 12.2 Workspaces

```text id="yswxtl"
GET    /workspaces
POST   /workspaces
GET    /workspaces/:workspaceId
PATCH  /workspaces/:workspaceId
DELETE /workspaces/:workspaceId
```

The workspace-detail response must include:

```ts id="mbgwfc"
interface WorkspaceGraphResponse {
  workspace: WorkspaceDto;
  topics: TopicDto[];
  nodes: MessageNodeDto[];
  activeTopicId: string | null;
}
```

Normal workspace responses exclude:

* Archived topics.
* Pruned messages.

Provide separate restoration endpoints or query modes.

## 12.3 Topics

```text id="8z2xf0"
POST  /workspaces/:workspaceId/topics
PATCH /topics/:topicId
POST  /topics/:topicId/move
PATCH /topics/:topicId/context
POST  /topics/:topicId/archive
POST  /topics/:topicId/restore
```

Topic move validation must prevent:

* Cross-workspace moves.
* Self-parenting.
* Moving a topic under its descendant.
* Moving under an archived topic unless explicitly supported.

## 12.4 Messages

```text id="aacl0i"
PATCH /nodes/:nodeId/context
PATCH /nodes/:nodeId/pin
POST  /nodes/:nodeId/prune
```

## 12.5 TreeMaker Preview

```text id="5g3ctg"
POST /workspaces/:workspaceId/tree-maker/preview
```

Request:

```ts id="o2zo1r"
interface TreeMakerPreviewRequest {
  prompt: string;
  activeTopicId: string | null;
  activeNodeId: string | null;
}
```

Response:

```ts id="9u8m6l"
interface TreeMakerPreviewResponse {
  decision: TreeMakerDecision;
  requiresConfirmation: boolean;
}
```

This endpoint must not mutate the graph.

## 12.6 Context Preview

```text id="jmknjo"
POST /workspaces/:workspaceId/context-preview
```

Request:

```ts id="q5zzfi"
interface ContextPreviewRequest {
  topicId: string;
  anchorNodeId: string | null;
  newPrompt: string;
  maxInputTokens: number | null;
}
```

Response is the serialized `AssembleContextResult`.

## 12.7 Generation

Use a discriminated request:

```text id="48jhs5"
POST /workspaces/:workspaceId/generations
```

```ts id="t7zvdf"
type StartGenerationRequest =
  | {
      mode: "auto_route";
      prompt: string;
      activeTopicId: string | null;
      activeNodeId: string | null;
    }
  | {
      mode: "manual_continue";
      prompt: string;
      topicId: string;
      anchorNodeId: string | null;
    }
  | {
      mode: "manual_subtopic";
      prompt: string;
      parentTopicId: string;
      title: string | null;
      description: string | null;
    }
  | {
      mode: "manual_root_topic";
      prompt: string;
      title: string | null;
      description: string | null;
    }
  | {
      mode: "regenerate";
      userNodeId: string;
    };
```

The initial response should return accepted IDs:

```ts id="4akqu1"
interface StartGenerationResponse {
  generationId: string;
  treeMakerRunId: string | null;
  topicId: string | null;
  userNodeId: string | null;
  assistantNodeId: string | null;

  status:
    | "accepted"
    | "clarification_required";

  clarification: {
    question: string;
    suggestedTopicIds: string[];
  } | null;
}
```

---

# 13. WebSocket Events

Use centralized event names in the shared package.

## 13.1 Client to Server

```text id="zm0v0w"
conversation.join
conversation.leave
```

Payloads must include the workspace ID.

## 13.2 Server to Client

```text id="0lcd1r"
conversation.joined
tree_maker.completed
tree_maker.clarification_required
topic.created
topic.updated
topic.moved
topic.context_updated
topic.archived
topic.restored
node.created
node.updated
node.context_updated
node.pruned
assistant.delta
assistant.completed
assistant.failed
capsule.updated
generation.failed
```

## 13.3 Event Envelope

Use a consistent envelope:

```ts id="oenc0n"
interface RealtimeEvent<T> {
  eventId: string;
  eventType: string;
  workspaceId: string;
  generationId: string | null;
  occurredAt: string;
  payload: T;
}
```

Requirements:

* `eventId` must support deduplication.
* Events must never update another workspace.
* Rejoining after disconnect must refetch the current graph.
* Delta events must identify the assistant node.
* Completion must not append content twice.

---

# 14. Frontend Requirements

## 14.1 Main Layout

```text id="4o9k90"
Left Sidebar
- Workspace list
- New workspace button
- Workspace settings

Center
- React Flow topic/message graph

Right Inspector
- Selected topic details
- Selected message details
- Context controls
- Topic actions
- Message actions

Bottom Composer
- Auto-route prompt input
- Manual placement controls
- Context preview
```

## 14.2 React Flow Node Types

Implement at least:

```text id="vh7huk"
topicNode
messageNode
```

### Topic Node Display

Show:

* Topic title.
* Root-topic or subtopic indicator.
* Short capsule summary.
* Context state.
* Inherited-disabled state.
* Archived state when shown in restoration views.
* Active state.
* TreeMaker-created indicator, if useful.

### Message Node Display

Show:

* User or assistant role.
* Content preview.
* Streaming status.
* Error status.
* Context state.
* Pinned state.
* Token count when available.
* Alternative-response relationship.

## 14.3 Edge Types

Visually distinguish:

```text id="37v8r8"
Topic → child topic
Topic → root message
Message → child message
```

Do not imply that a child topic is an assistant response.

## 14.4 Forest Layout

The workspace graph is a forest:

* Multiple root topics may exist.
* Root topics must be visually separate.
* Subtopics attach to parent topics.
* Messages attach to their owning topic.
* Alternative assistant responses appear as sibling message branches.

Use deterministic layout.

Persisted manual node positions are optional and out of scope unless already implemented.

## 14.5 Composer

Default mode:

```text id="5qunti"
Auto-organize
```

The composer must show:

* Current active topic.
* Current selected message anchor.
* Whether TreeMaker will route the prompt.
* A context-preview button.
* Prompt text area.
* Submit state.

Manual placement menu:

```text id="ft29f2"
Continue selected topic
Create subtopic
Create independent topic
```

## 14.6 Placement Feedback

After TreeMaker applies a decision, show feedback such as:

```text id="rm8sqi"
Added to: Authentication → Refresh-token storage
```

Provide:

* View topic.
* Move.
* Undo when technically safe.

For medium-confidence decisions, make the feedback more prominent.

## 14.7 Low-Confidence Clarification

When TreeMaker returns `ask_user`:

* Do not lose the prompt.
* Show the TreeMaker question.
* Show suggested topics.
* Allow selection of:

    * Suggested topic.
    * New subtopic.
    * New root topic.
* Continue generation after the user resolves placement.

## 14.8 Topic Inspector

Show:

* Title.
* Description.
* Capsule.
* Parent topic.
* Child-topic count.
* Message count.
* Context state.
* Effective inherited state.
* Active node.
* Creation source.

Actions:

* Rename.
* Edit description.
* Include or exclude from context.
* Create subtopic.
* Move topic.
* Archive.
* Restore where applicable.

## 14.9 Message Inspector

Show:

* Full content.
* Role.
* Topic.
* Parent message.
* Child messages.
* Generation status.
* Token count.
* Context state.
* Pinned state.
* Error information.

Actions:

* Continue from here.
* Regenerate, when a user node is selected.
* Include or exclude from context.
* Pin or unpin.
* Prune branch.

## 14.10 Context Preview Drawer

Display:

* Workspace system prompt.
* Topic capsule lineage.
* Raw included messages.
* New prompt.
* Excluded topics.
* Excluded messages.
* Exclusion reasons.
* Warnings.
* Estimated token count.
* Token trimming.

Allow clicking an included or excluded item to center it in the graph.

## 14.11 Context States

Visually distinguish:

```text id="dvvq3k"
Enabled
Directly excluded
Inherited exclusion
Archived
Pruned
```

Context-excluded nodes remain visible.

Archived topics and pruned messages are hidden from the normal graph.

## 14.12 Streaming

During generation:

* Create the user and assistant nodes immediately after acceptance.
* Display assistant streaming state.
* Apply deltas to the correct node.
* Prevent duplicate text.
* Center or select the active response without disruptive repeated zooming.
* Allow navigation while streaming.
* Display failure and retry state.

## 14.13 Reconnection

Show:

```text id="4eop0y"
Connected
Reconnecting
Disconnected
```

On reconnection:

1. Rejoin the workspace room.
2. Refetch the graph.
3. Reconcile streaming states.
4. Deduplicate events.
5. Do not duplicate assistant text.

---

# 15. Manual Correction Features

TreeMaker will occasionally be wrong.

The product must support correction.

## 15.1 Move Topic

A user may move:

* Root topic under another topic.
* Subtopic to another parent.
* Subtopic to root.

Moving a topic changes future inherited context.

It must not rewrite historical generation snapshots.

## 15.2 Rename Topic

Renaming changes display and future capsules.

It must not mutate old generation snapshots.

## 15.3 Undo Placement

When a newly created topic has no additional dependent activity, allow undo by:

* Moving the prompt to another topic.
* Deleting the newly created empty topic after relocation.

If safe undo is complex, provide `Move` as the reliable correction mechanism.

## 15.4 Merge Topics

Topic merging is not required for the initial refactor.

Document it as future work.

---

# 16. Archive, Prune, and Context Exclusion

These are separate concepts.

## 16.1 Context Exclusion

```text id="cmfvml"
Visible in graph: Yes
Used in future context: No
Restorable: Yes, by re-enabling
```

## 16.2 Topic Archive

```text id="z2u6yh"
Visible in normal graph: No
Used in future context: No
Restorable: Yes
```

Archiving a topic also hides descendant topics in normal views.

## 16.3 Message Prune

```text id="emw6es"
Visible in normal graph: No
Used in future context: No
Restorable: Optional for MVP
```

Pruning affects the selected message and message descendants, not sibling branches.

## 16.4 Historical Snapshots

Context exclusion, archival, and pruning must not rewrite old generation snapshots.

---

# 17. Comparison

Support comparison of:

* Alternative assistant responses.
* Two branches in one topic.
* Sibling subtopics.
* Independent root topics.

The comparison service should return:

```ts id="mom0wz"
interface ComparisonResult {
  nearestCommonTopicId: string | null;
  nearestCommonMessageId: string | null;

  sharedTopicPath: TopicDto[];
  sharedMessagePath: MessageNodeDto[];

  branchATopics: TopicDto[];
  branchAMessages: MessageNodeDto[];

  branchBTopics: TopicDto[];
  branchBMessages: MessageNodeDto[];
}
```

Independent root topics have no common topic ancestor.

Do not fabricate shared context.

---

# 18. Existing Data Migration

The current Day 1–2 implementation may already contain:

* Workspaces or conversations.
* Message trees.
* Alternative mock responses.
* Active node fields.
* Seed data.
* React Flow transformations.

Use an additive migration.

## 18.1 Migration Rules

For every existing workspace:

1. Create one root topic.
2. Use a title such as `Imported conversation` or derive it safely.
3. Assign all existing message nodes to that topic.
4. Preserve existing message `parentId` relationships.
5. Move the old active-node value into the topic’s `activeNodeId`.
6. Set topic `contextEnabled = true`.
7. Set message `contextEnabled = true`.
8. Create a basic migration-generated context capsule.
9. Preserve timestamps when practical.
10. Do not delete old records until the new system is verified.

## 18.2 Compatibility Fields

Temporary compatibility fields are acceptable only when:

* Clearly marked deprecated.
* Not exposed as the new public API.
* Documented with a removal condition.
* Removed before final project completion when safe.

## 18.3 Seed Data

Provide a complete demo workspace containing:

```text id="g4jx2x"
Root Topic: ArborAI architecture
├── Main message exchange
├── Subtopic: TreeMaker routing
│   └── Message exchange
├── Subtopic: Context capsules
│   └── Message exchange with one disabled node
└── Subtopic: Provider abstraction
    └── User message with two alternative assistant answers

Root Topic: Interview preparation
└── Independent message exchange
```

Also include:

* One context-disabled subtopic.
* One pinned message.
* Token data.
* At least one completed generation snapshot.
* At least one TreeMaker run.

---

# 19. Repository Knowledge Base

Create or rewrite:

```text id="n92sez"
AGENTS.md
README.md
docs/product-model.md
docs/architecture.md
docs/tree-maker.md
docs/context-rules.md
docs/api-contracts.md
docs/realtime-events.md
docs/local-development.md
docs/context-benchmark.md
docs/demo-script.md
docs/project-status.md
docs/decisions/001-topic-aware-workspace.md
docs/decisions/002-context-capsules-not-transcript-copies.md
docs/decisions/003-tree-maker-and-context-engine-separation.md
```

## 19.1 AGENTS.md

Must instruct future Codex sessions to:

* Read the product and architecture documents.
* Keep topics separate from message nodes.
* Keep TreeMaker separate from the Context Engine.
* Avoid copying full ancestor transcripts into nodes.
* Preserve mock mode.
* Avoid unrelated refactors.
* Update schemas and tests with contract changes.
* Run verification commands.
* Never commit secrets.

## 19.2 Product Documentation

Clearly state:

> ArborAI uses an AI routing agent to automatically organize prompts into existing topics, new subtopics, or independent root topics. A deterministic context engine then assembles enabled topic capsules and selected message paths for the answering model.

---

# 20. Testing Requirements

## 20.1 Unit Tests

Cover:

### TreeMaker Validation

* Valid continuation.
* Valid subtopic.
* Valid root topic.
* Clarification decision.
* Unknown topic ID.
* Archived topic.
* Cross-workspace topic.
* Invalid confidence.
* Malformed structured output.
* Fallback behavior.

### Topic Graph

* Root-topic creation.
* Subtopic creation.
* Topic ancestry.
* Cycle detection.
* Topic movement.
* Moving to root.
* Invalid descendant move.
* Effective context state.

### Message Graph

* Linear thread.
* Alternative assistant responses.
* Selected branch path.
* Cross-topic parent rejection.
* Message-cycle detection.
* Pruned subtree resolution.

### Context Engine

* Independent root isolation.
* Sibling-subtopic isolation.
* Topic-lineage capsules.
* Selected message path.
* Alternative-answer selection.
* Disabled topic.
* Disabled ancestor topic.
* Disabled message.
* Context-gap warning.
* Pinned message.
* Pruned message.
* Archived topic.
* Token trimming.
* Missing capsule.
* Empty topic.
* New root topic receiving no unrelated context.

### Capsule System

* Root capsule creation.
* Child capsule inheritance.
* Capsule update.
* Deduplication.
* Failure preserving existing capsule.

### Realtime State

* Event deduplication.
* Out-of-order node and completion events.
* Delta deduplication.
* Workspace switching.
* Reconnection reconciliation.

## 20.2 Backend Integration Tests

Cover:

1. Create workspace.
2. Auto-route prompt to a new root topic.
3. Auto-route follow-up to the same topic.
4. Auto-route related concern to a subtopic.
5. Auto-route unrelated prompt to another root topic.
6. Handle low-confidence clarification.
7. Manual topic placement.
8. Regenerate an answer.
9. Persist generation snapshot.
10. Update context capsule.
11. Toggle topic context.
12. Toggle message context.
13. Context preview.
14. Archive and restore topic.
15. Prune message branch.
16. Move topic.
17. Provider failure.
18. TreeMaker failure with fallback.
19. Capsule failure without generation failure.

All tests must run in mock mode.

## 20.3 Browser Smoke Test

Implement one complete deterministic browser workflow:

1. Open ArborAI.
2. Create a workspace.
3. Submit an authentication question using auto-route.
4. Confirm a root topic is created.
5. Observe streamed mock response.
6. Submit a direct follow-up.
7. Confirm it continues the existing topic.
8. Submit a password-reset question.
9. Confirm a subtopic is created.
10. Submit an unrelated Docker question.
11. Confirm a second root topic is created.
12. Open context preview for Docker.
13. Confirm authentication content is excluded.
14. Disable one authentication message.
15. Regenerate one assistant response.
16. Compare both alternatives.
17. Move one subtopic.
18. Reload the page.
19. Confirm persisted graph state.

## 20.4 Real-Provider Test

Do not run real-provider calls in normal CI.

Provide an optional manually invoked test command that requires credentials.

---

# 21. Context Benchmark

Add:

```text id="rn0rdt"
pnpm benchmark:context
```

Benchmark deterministic fixtures:

```text id="qq6n4v"
Linear single topic
Single topic with alternative responses
Root topic with multiple subtopics
Deep nested subtopics
Multiple independent root topics
Disabled topic
Disabled message
Mixed large workspace
```

For each scenario report:

```ts id="e0k2n2"
interface ContextBenchmarkResult {
  scenario: string;

  naiveWorkspaceTokens: number;
  assembledContextTokens: number;

  savedTokens: number;
  savingsPercentage: number;

  includedTopicCount: number;
  includedNodeCount: number;
  excludedTopicCount: number;
  excludedNodeCount: number;
}
```

Definitions:

* `naiveWorkspaceTokens`: all visible, non-archived, non-pruned messages and topic summaries in the workspace.
* `assembledContextTokens`: the context actually sent for the selected prompt.
* `savingsPercentage`:

```text id="1qtnim"
100 ×
(naiveWorkspaceTokens - assembledContextTokens)
/
naiveWorkspaceTokens
```

Generate:

```text id="rl2o8v"
artifacts/context-benchmark.json
docs/context-benchmark.md
```

Do not force a specific percentage.

---

# 22. Docker and Local Development

## 22.1 Root Commands

Provide working root commands equivalent to:

```text id="zfn3zd"
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm db:migrate
pnpm db:seed
pnpm benchmark:context
```

Match the repository’s actual package manager.

## 22.2 Docker Compose

Include:

```text id="s6v1v1"
web
api
postgres
```

Requirements:

* Database health check.
* API database retry.
* Mock mode by default.
* Migrations run through an explicit documented mechanism.
* Seed command available.
* No credentials baked into images.
* Graceful shutdown.
* Production-capable multi-stage builds where appropriate.

A clean user should be able to run:

```text id="ir27r2"
cp .env.example .env
docker compose up --build
```

and use the application in mock mode.

## 22.3 Real Provider Activation

After mock mode works, real mode should require only:

```text id="1qprhh"
AI_PROVIDER=openai
OPENAI_API_KEY=<credential>
ANSWER_MODEL=<model>
TREE_MAKER_MODEL=<model>
CAPSULE_MODEL=<model>
```

Restarting the API should activate the provider.

No source-code edits should be required.

---

# 23. GitHub Actions

Run on:

* Pull requests.
* Pushes to the main branch.

Required checks:

```text id="ktd6fe"
Formatting
Lint
Typecheck
Unit tests
Integration tests
Production builds
```

Add browser smoke testing if it is stable enough for CI.

Requirements:

* Use mock provider.
* Use PostgreSQL service when required.
* Use the committed lockfile.
* Cache dependencies safely.
* Cancel superseded runs.
* Do not require AI credentials.
* Upload browser-test artifacts on failure.
* Never print secrets.

---

# 24. Security and Reliability

## 24.1 Secrets

* Provider keys remain server-side.
* Never include keys in TreeMaker input.
* Never store keys in generation snapshots.
* Never expose keys through frontend environment variables.
* Never commit real `.env` files.

## 24.2 Input Validation

Validate:

* Prompt length.
* Topic title length.
* Description length.
* Workspace ownership relationships.
* Topic ancestry.
* Message ancestry.
* TreeMaker output.
* Provider structured output.
* WebSocket payloads.
* REST DTOs.

## 24.3 Model Output

Treat all model output as untrusted.

* Validate TreeMaker decisions.
* Validate capsules.
* Limit generated array lengths.
* Sanitize display where needed.
* Do not allow model output to choose arbitrary database operations.

## 24.4 Logging

Log:

* Generation IDs.
* TreeMaker run IDs.
* Provider name.
* Model name.
* Status transitions.
* Validation failures.
* Latency.
* Token usage when available.

Do not log:

* Credentials.
* Full system prompts in production logs.
* Sensitive user content unnecessarily.

## 24.5 Cancellation

Support generation cancellation if practical.

At minimum:

* Handle client disconnect without corrupting state.
* Handle server shutdown.
* Persist an error or cancelled state.
* Never leave nodes permanently streaming.

---

# 25. Non-Goals

Do not add these during this refactor:

* Authentication.
* Multiple-user permissions.
* Real-time collaborative editing.
* File uploads.
* Retrieval-augmented generation.
* Vector databases.
* Embeddings.
* Billing.
* Subscriptions.
* Mobile-native applications.
* Voice interaction.
* Autonomous shell execution.
* Codex repository modification tools.
* Topic merging.
* Production cloud deployment.

Keep provider abstraction compatible with future Codex integration, but ArborAI is not a Codex fork.

---

# 26. Required Implementation Sequence

Perform the refactor in this order.

## Phase 1: Audit

1. Inspect repository structure.
2. Identify existing Day 1–2 behavior.
3. Identify current schema and migrations.
4. Identify API and frontend assumptions.
5. Record migration risks in `docs/project-status.md`.

## Phase 2: Knowledge Base

1. Rewrite repository documentation.
2. Update `AGENTS.md`.
3. Add architectural decision records.
4. Mark previous message-only assumptions obsolete.

## Phase 3: Domain Migration

1. Add topic model.
2. Add context capsules.
3. Add TreeMaker runs.
4. Add generations.
5. Add generation snapshots.
6. Backfill existing data.
7. Update seed data.

## Phase 4: Shared Contracts

1. Add runtime schemas.
2. Add TreeMaker actions.
3. Add generation requests.
4. Add WebSocket envelopes.
5. Add context-preview contracts.

## Phase 5: Backend Core

1. Topic service.
2. TreeMaker service.
3. TreeMaker validation.
4. Context-capsule service.
5. Deterministic context engine.
6. Provider abstraction.
7. Generation lifecycle.
8. WebSocket broadcasting.

## Phase 6: Frontend Refactor

1. Topic forest graph.
2. Topic and message inspectors.
3. Auto-route composer.
4. Placement feedback.
5. Clarification workflow.
6. Context preview.
7. Context controls.
8. Streaming updates.
9. Reconnection.
10. Archive, prune, move, and comparison.

## Phase 7: Verification

1. Unit tests.
2. Integration tests.
3. Browser smoke test.
4. Context benchmark.
5. Docker.
6. GitHub Actions.
7. README and demo script.

Do not implement the frontend against temporary undocumented response shapes.

---

# 27. Definition of Done

The refactor is complete only when all of the following work.

## 27.1 Mock Mode

With no AI credentials:

```text id="3c8pgl"
1. Start PostgreSQL.
2. Run migrations.
3. Start API and web.
4. Create a workspace.
5. Submit a prompt.
6. TreeMaker creates a root topic.
7. Mock answer streams.
8. Submit a direct follow-up.
9. TreeMaker continues the topic.
10. Submit a related but distinct concern.
11. TreeMaker creates a subtopic.
12. Submit an unrelated question.
13. TreeMaker creates another root topic.
14. Context preview proves root-topic isolation.
15. Refresh preserves the graph.
```

## 27.2 Real Mode

After adding valid provider credentials and model names:

* TreeMaker uses the real provider.
* Answering uses the real provider.
* Capsule updates use the real provider.
* No source changes are required.
* Mock mode remains available.

## 27.3 Context Control

Users can:

* Disable a topic from context.
* Re-enable a topic.
* Disable an individual message.
* Pin a message.
* Preview context.
* See exclusion reasons.
* Confirm unrelated root topics are omitted.

## 27.4 Correction

Users can:

* Rename a topic.
* Move a topic.
* Convert a subtopic to a root topic.
* Continue from a selected message.
* Manually override auto-routing.
* Archive a topic.
* Prune a message branch.

## 27.5 Reliability

* Reconnection does not duplicate response text.
* Two tabs converge to the same graph.
* Provider failure produces a recoverable error.
* TreeMaker failure uses a safe fallback.
* Capsule failure does not erase a successful answer.
* No node remains permanently streaming.

## 27.6 Repository Quality

* Documentation matches implementation.
* All root commands work.
* Migrations work from an empty database.
* Seed data works.
* Tests pass.
* Builds pass.
* Docker starts the complete application.
* CI runs without provider credentials.
* No secrets are committed.

---

# 28. Final User Setup

The final local setup should be documented as approximately:

```text id="1asjba"
1. Clone the repository.
2. Copy .env.example to .env.
3. Start PostgreSQL or Docker Compose.
4. Install dependencies.
5. Run migrations.
6. Seed optional demo data.
7. Start the application.
```

Mock mode must work immediately.

To enable real AI:

```text id="g7jlef"
1. Set AI_PROVIDER.
2. Add the API credential.
3. Set the answer, TreeMaker, and capsule model names.
4. Restart the backend.
```

No additional implementation should be required.

---

# 29. Final Product Statement

The completed project should accurately be described as:

> ArborAI is a visual AI knowledge workspace that uses a TreeMaker routing agent to automatically organize prompts into existing topics, nested subtopics, or independent roots. A deterministic context engine assembles enabled topic capsules and selected message paths, while immutable generation snapshots preserve exactly what was sent to the model.

The architecture must make this statement true in the implementation, not only in documentation.
