import { PrismaClient, TopicCreatedBy } from '@prisma/client';
import {
  findLegacyImportTopic,
  LEGACY_MESSAGE_TREE_IMPORT_KEY,
  validateLegacyMessageTree,
} from '../dist/legacy-backfill.js';

const prisma = new PrismaClient();
const capsuleFor = (topicId) => ({
  summary: 'Imported from the legacy message tree. Historical message content remains in its original nodes.',
  facts: [],
  decisions: [],
  constraints: [],
  openQuestions: [],
  sourceTopicIds: [topicId],
  sourceNodeIds: [],
  generatedBy: 'legacy-message-backfill',
});

async function readLegacyActiveNodeIds() {
  try {
    const rows = await prisma.$queryRaw`SELECT "id", "activeNodeId" FROM "Conversation"`;
    return new Map(rows.map((row) => [row.id, row.activeNodeId]));
  } catch (error) {
    // Databases created from a later baseline may no longer retain the legacy
    // column. Topic.activeNodeId remains the authoritative compatibility value.
    if (error?.code === 'P2010') return new Map();
    throw error;
  }
}

try {
  const [conversations, topics, nodes, legacyActiveNodeIds] = await Promise.all([
    prisma.conversation.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.topic.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.conversationNode.findMany({ orderBy: { createdAt: 'asc' } }),
    readLegacyActiveNodeIds(),
  ]);

  const reports = conversations.map((conversation) => validateLegacyMessageTree(
    conversation.id,
    topics,
    nodes,
    legacyActiveNodeIds.get(conversation.id) ?? null,
  ));
  const issues = reports.flatMap((report) => report.issues.map((issue) => ({ conversationId: report.conversationId, ...issue })));
  console.log(JSON.stringify({ validation: reports, issueCount: issues.length }, null, 2));
  if (issues.length > 0) {
    console.error('Legacy backfill made no changes because validation issues were found. Resolve the reported data first.');
    process.exitCode = 1;
  } else {
    for (const conversation of conversations) {
      const conversationTopics = topics.filter((topic) => topic.conversationId === conversation.id);
      let importedTopic = findLegacyImportTopic(conversationTopics);
      const legacyActiveNodeId = legacyActiveNodeIds.get(conversation.id) ?? null;

      await prisma.$transaction(async (tx) => {
        if (!importedTopic && conversationTopics.length === 0) {
          importedTopic = await tx.topic.create({
            data: {
              conversationId: conversation.id,
              title: 'Imported conversation',
              description: 'Imported from the conversation message tree.',
              contextEnabled: true,
              createdBy: TopicCreatedBy.migration,
              legacyImportKey: LEGACY_MESSAGE_TREE_IMPORT_KEY,
              createdAt: conversation.createdAt,
            },
          });
          await tx.topic.update({ where: { id: importedTopic.id }, data: { contextCapsule: capsuleFor(importedTopic.id) } });
        }
        if (!importedTopic) return;

        // Only an untouched legacy workspace can be reassigned. Once it has
        // more than this imported root topic, it is topic-aware data and must
        // never be flattened on a repeat run.
        const isUntouchedLegacyWorkspace = conversationTopics.length <= 1;
        const activeNodeId = legacyActiveNodeId ?? importedTopic.activeNodeId;
        if (isUntouchedLegacyWorkspace) {
          await tx.conversationNode.updateMany({
            where: { conversationId: conversation.id, topicId: { not: importedTopic.id } },
            data: { topicId: importedTopic.id },
          });
        }
        if (!importedTopic.contextCapsule) {
          await tx.topic.update({
            where: { id: importedTopic.id },
            data: { contextCapsule: capsuleFor(importedTopic.id), capsuleVersion: 1, capsuleUpdatedAt: new Date(), contextEnabled: true },
          });
        }
        if (isUntouchedLegacyWorkspace && conversation.activeTopicId !== importedTopic.id) {
          await tx.conversation.update({ where: { id: conversation.id }, data: { activeTopicId: importedTopic.id } });
        }
        if (isUntouchedLegacyWorkspace && activeNodeId !== importedTopic.activeNodeId) {
          await tx.topic.update({ where: { id: importedTopic.id }, data: { activeNodeId } });
        }
      });
    }
    console.log(`Legacy backfill completed for ${conversations.length} workspace(s).`);
  }
} finally {
  await prisma.$disconnect();
}
