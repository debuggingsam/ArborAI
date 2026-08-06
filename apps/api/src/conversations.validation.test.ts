import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCreateConversationRequest, validateUpdateConversationRequest } from '@arborai/shared';

test('conversation validation enforces title and system prompt limits', () => {
  assert.equal(validateCreateConversationRequest({ title: 'x'.repeat(201) }).success, false);
  assert.equal(validateCreateConversationRequest({ title: 'Valid', systemPrompt: 'x'.repeat(10_001) }).success, false);
  assert.equal(validateUpdateConversationRequest({}).success, false);
});
