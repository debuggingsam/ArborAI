-- Marks the one topic created by the original message-tree migration. The
-- marker makes the operational backfill safe to rerun without creating a
-- second imported topic for a workspace.
ALTER TABLE "Topic" ADD COLUMN "legacyImportKey" TEXT;

CREATE UNIQUE INDEX "Topic_conversationId_legacyImportKey_key"
  ON "Topic"("conversationId", "legacyImportKey");

UPDATE "Topic"
SET "legacyImportKey" = 'legacy-message-tree-v1'
WHERE "createdBy" = 'migration'
  AND "parentTopicId" IS NULL
  AND "title" = 'Imported conversation'
  AND "description" = 'Imported from the conversation message tree.';

-- The earlier additive migration already assigned every legacy node to this
-- topic. Add a compact provenance capsule; no historical transcript is copied.
UPDATE "Topic"
SET
  "contextEnabled" = true,
  "contextCapsule" = jsonb_build_object(
    'summary', 'Imported from the legacy message tree. Historical message content remains in its original nodes.',
    'facts', jsonb_build_array(),
    'decisions', jsonb_build_array(),
    'constraints', jsonb_build_array(),
    'openQuestions', jsonb_build_array(),
    'sourceTopicIds', jsonb_build_array("id"),
    'sourceNodeIds', jsonb_build_array(),
    'generatedBy', 'legacy-message-backfill'
  ),
  "capsuleVersion" = 1,
  "capsuleUpdatedAt" = CURRENT_TIMESTAMP
WHERE "legacyImportKey" = 'legacy-message-tree-v1'
  AND "contextCapsule" IS NULL;

UPDATE "ConversationNode" AS node
SET "contextEnabled" = true
FROM "Topic" AS topic
WHERE topic."id" = node."topicId"
  AND topic."legacyImportKey" = 'legacy-message-tree-v1';
