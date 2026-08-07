import {
  TopicContextCapsuleEntriesMaxCount,
  TopicContextCapsuleEntryMaxLength,
  TopicContextCapsuleSchema,
  TopicContextCapsuleSourceIdsMaxCount,
  TopicContextCapsuleSummaryMaxLength,
  type TopicContextCapsule,
} from '@arborai/shared';
import type { AiProvider } from './ai-provider.js';
import { contextCapsuleSystemPrompt, topicContextCapsuleJsonSchema } from './context-capsule-prompt.js';

export type CapsuleTopicRecord = {
  id: string;
  conversationId: string;
  parentTopicId: string | null;
  title: string;
  description: string | null;
  contextCapsule: TopicContextCapsule | null;
  capsuleVersion: number;
};

export interface ContextCapsuleStore {
  findTopic(id: string): Promise<CapsuleTopicRecord | null>;
  listTopics(workspaceId: string): Promise<CapsuleTopicRecord[]>;
  saveCapsule(topicId: string, capsule: TopicContextCapsule): Promise<void>;
}

export type CreateRootCapsuleInput = {
  topicId: string;
  workspaceInstructions: string;
  userPrompt: string;
  sourceNodeId?: string;
};

export type CreateChildCapsuleInput = {
  topicId: string;
  userPrompt: string;
  sourceNodeId?: string;
};

export type UpdateCapsuleInput = {
  topicId: string;
  userPrompt: string;
  assistantResponse: string;
  userNodeId: string;
  assistantNodeId: string;
};

export type CapsuleUpdateResult =
  | { status: 'updated'; capsule: TopicContextCapsule }
  | { status: 'unchanged'; capsule: TopicContextCapsule }
  | { status: 'failed'; error: string };

/**
 * Creates and updates bounded topic capsules. This service has no controller,
 * Context Engine, or provider-SDK dependency; callers can safely treat a
 * failed post-generation update as non-fatal.
 */
export class ContextCapsuleService {
  constructor(
    private readonly store: ContextCapsuleStore,
    private readonly provider: AiProvider,
    private readonly model: string,
    private readonly logger: Pick<Console, 'warn'> = console,
  ) {}

  async createRoot(input: CreateRootCapsuleInput): Promise<CapsuleUpdateResult> {
    const topic = await this.requireTopic(input.topicId);
    if (topic.parentTopicId) throw new ContextCapsuleValidationError('Root capsule creation requires a root topic.');
    return this.create(topic, [], input.userPrompt, input.sourceNodeId ? [input.sourceNodeId] : [], input.workspaceInstructions);
  }

  async createChild(input: CreateChildCapsuleInput): Promise<CapsuleUpdateResult> {
    const topic = await this.requireTopic(input.topicId);
    if (!topic.parentTopicId) throw new ContextCapsuleValidationError('Child capsule creation requires a subtopic.');
    const lineage = await this.lineage(topic);
    return this.create(topic, lineage.slice(0, -1), input.userPrompt, input.sourceNodeId ? [input.sourceNodeId] : []);
  }

  async updateAfterSuccessfulResponse(input: UpdateCapsuleInput): Promise<CapsuleUpdateResult> {
    return this.update(input);
  }

  /** Manual retry uses the same persisted exchange inputs and never clears the old capsule first. */
  async retryUpdate(input: UpdateCapsuleInput): Promise<CapsuleUpdateResult> {
    return this.update(input);
  }

  private async create(topic: CapsuleTopicRecord, ancestors: CapsuleTopicRecord[], userPrompt: string, sourceNodeIds: string[], workspaceInstructions = ''): Promise<CapsuleUpdateResult> {
    try {
      const inherited = inheritedCapsule(ancestors);
      const capsule = await this.generate({
        operation: 'create', topic, existingCapsule: null, inheritedCapsule: inherited,
        workspaceInstructions: compactText(workspaceInstructions, 2_000), userPrompt: compactText(userPrompt, 2_000), assistantResponse: '',
        sourceTopicIds: sourceTopicIdsFor(topic, ancestors),
        sourceNodeIds: uniqueIds([...ancestors.flatMap((ancestor) => ancestor.contextCapsule?.sourceNodeIds ?? []), ...sourceNodeIds]),
      });
      await this.store.saveCapsule(topic.id, capsule);
      return { status: 'updated', capsule };
    } catch (error) {
      return this.failure(topic.id, error);
    }
  }

  private async update(input: UpdateCapsuleInput): Promise<CapsuleUpdateResult> {
    const topic = await this.requireTopic(input.topicId);
    const oldCapsule = topic.contextCapsule;
    try {
      const lineage = await this.lineage(topic);
      const capsule = await this.generate({
        operation: 'update', topic, existingCapsule: oldCapsule, inheritedCapsule: inheritedCapsule(lineage.slice(0, -1)),
        workspaceInstructions: '', userPrompt: compactText(input.userPrompt, 2_000), assistantResponse: compactText(input.assistantResponse, 4_000),
        sourceTopicIds: sourceTopicIdsFor(topic, lineage.slice(0, -1)),
        sourceNodeIds: uniqueIds([...(oldCapsule?.sourceNodeIds ?? []), input.userNodeId, input.assistantNodeId]),
      });
      const merged = oldCapsule ? mergeExistingCapsule(oldCapsule, capsule) : capsule;
      if (oldCapsule && sameCapsule(oldCapsule, merged)) return { status: 'unchanged', capsule: oldCapsule };
      await this.store.saveCapsule(topic.id, merged);
      return { status: 'updated', capsule: merged };
    } catch (error) {
      return this.failure(topic.id, error);
    }
  }

  private async generate(payload: Record<string, unknown> & { sourceTopicIds: string[]; sourceNodeIds: string[] }): Promise<TopicContextCapsule> {
    const candidate = await this.provider.createStructuredOutput({
      model: this.model, systemPrompt: contextCapsuleSystemPrompt, payload,
      schema: TopicContextCapsuleSchema, schemaName: 'topic_context_capsule', jsonSchema: topicContextCapsuleJsonSchema,
    });
    const validated = TopicContextCapsuleSchema.safeParse(candidate);
    if (!validated.success) throw new ContextCapsuleValidationError(`Provider returned an invalid capsule: ${validated.errors.join('; ')}`);
    return normalizeCapsule(validated.data, payload.sourceTopicIds, payload.sourceNodeIds);
  }

  private async lineage(topic: CapsuleTopicRecord): Promise<CapsuleTopicRecord[]> {
    const topics = await this.store.listTopics(topic.conversationId);
    const byId = new Map(topics.map((item) => [item.id, item]));
    const lineage: CapsuleTopicRecord[] = [];
    const seen = new Set<string>();
    let current: CapsuleTopicRecord | undefined = topic;
    while (current) {
      if (seen.has(current.id)) throw new ContextCapsuleValidationError('Topic lineage contains a cycle.');
      if (current.conversationId !== topic.conversationId) throw new ContextCapsuleValidationError('Topic lineage crosses workspaces.');
      seen.add(current.id);
      lineage.unshift(current);
      current = current.parentTopicId ? byId.get(current.parentTopicId) : undefined;
      if (lineage[0]?.parentTopicId && !current) throw new ContextCapsuleValidationError('Topic lineage has a missing parent.');
    }
    return lineage;
  }

  private async requireTopic(id: string): Promise<CapsuleTopicRecord> {
    const topic = await this.store.findTopic(id);
    if (!topic) throw new ContextCapsuleValidationError('Topic not found.');
    return topic;
  }

  private failure(topicId: string, error: unknown): CapsuleUpdateResult {
    const message = error instanceof Error ? error.message : 'Capsule update failed.';
    this.logger.warn(`Capsule update failed for topic ${topicId}: ${message}`);
    return { status: 'failed', error: message };
  }
}

export class ContextCapsuleValidationError extends Error {}

function inheritedCapsule(ancestors: CapsuleTopicRecord[]) {
  return ancestors.map((topic) => topic.contextCapsule).filter((capsule): capsule is TopicContextCapsule => capsule !== null);
}
function sourceTopicIdsFor(topic: CapsuleTopicRecord, ancestors: CapsuleTopicRecord[]) {
  return uniqueIds([...ancestors.flatMap((ancestor) => ancestor.contextCapsule?.sourceTopicIds ?? []), ...ancestors.map((ancestor) => ancestor.id), topic.id]);
}
function normalizeCapsule(capsule: TopicContextCapsule, sourceTopicIds: string[], sourceNodeIds: string[]): TopicContextCapsule {
  return {
    summary: compactText(capsule.summary, TopicContextCapsuleSummaryMaxLength),
    facts: normalizeEntries(capsule.facts), decisions: normalizeEntries(capsule.decisions),
    constraints: normalizeEntries(capsule.constraints), openQuestions: normalizeEntries(capsule.openQuestions),
    sourceTopicIds: uniqueIds(sourceTopicIds), sourceNodeIds: uniqueIds(sourceNodeIds),
  };
}
function mergeExistingCapsule(existing: TopicContextCapsule, candidate: TopicContextCapsule): TopicContextCapsule {
  return {
    ...candidate,
    facts: normalizeEntries([...existing.facts, ...candidate.facts]),
    decisions: normalizeEntries([...existing.decisions, ...candidate.decisions]),
    constraints: normalizeEntries([...existing.constraints, ...candidate.constraints]),
    // Open questions intentionally come from the new candidate so a resolved
    // question can be removed instead of being reintroduced by a blind merge.
    sourceTopicIds: uniqueIds([...existing.sourceTopicIds, ...candidate.sourceTopicIds]),
    sourceNodeIds: uniqueIds([...existing.sourceNodeIds, ...candidate.sourceNodeIds]),
  };
}
function normalizeEntries(entries: string[]) {
  const seen = new Set<string>();
  return entries.map((entry) => compactText(entry, TopicContextCapsuleEntryMaxLength)).filter((entry) => {
    const key = entry.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, TopicContextCapsuleEntriesMaxCount);
}
function uniqueIds(ids: string[]) { return [...new Set(ids.filter((id) => id.trim().length > 0))].slice(0, TopicContextCapsuleSourceIdsMaxCount); }
function compactText(value: string, limit: number) { const compact = value.replace(/\s+/g, ' ').trim(); return compact.length <= limit ? compact : `${compact.slice(0, Math.max(0, limit - 1)).trimEnd()}…`; }
function sameCapsule(left: TopicContextCapsule, right: TopicContextCapsule) { return JSON.stringify(left) === JSON.stringify(right); }
