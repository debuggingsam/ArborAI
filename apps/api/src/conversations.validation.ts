const ConversationTitleMaxLength = 200;
const ConversationSystemPromptMaxLength = 10_000;

type Result<T> = { success: true; data: T } | { success: false; errors: string[] };
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const result = <T>(value: unknown, checks: Array<[string, boolean]>): Result<T> => {
  const errors = checks.filter(([, valid]) => !valid).map(([name]) => name);
  return errors.length ? { success: false, errors } : { success: true, data: value as T };
};
export function validateCreateConversationRequest(value: unknown): Result<{ title: string; systemPrompt?: string }> {
  if (!record(value)) return { success: false, errors: ['request must be an object'] };
  return result(value, [
    ['title must be a non-empty string', nonEmpty(value.title)],
    [`title must be at most ${ConversationTitleMaxLength} characters`, typeof value.title === 'string' && value.title.length <= ConversationTitleMaxLength],
    ['systemPrompt must be a string when provided', value.systemPrompt === undefined || typeof value.systemPrompt === 'string'],
    [`systemPrompt must be at most ${ConversationSystemPromptMaxLength} characters`, value.systemPrompt === undefined || typeof value.systemPrompt !== 'string' || value.systemPrompt.length <= ConversationSystemPromptMaxLength],
  ]);
}
export function validateUpdateConversationRequest(value: unknown): Result<{ title?: string; systemPrompt?: string }> {
  if (!record(value)) return { success: false, errors: ['request must be an object'] };
  const title = value.title !== undefined; const prompt = value.systemPrompt !== undefined;
  return result(value, [
    ['request must include title or systemPrompt', title || prompt],
    ['title must be a non-empty string when provided', !title || nonEmpty(value.title)],
    [`title must be at most ${ConversationTitleMaxLength} characters`, !title || (typeof value.title === 'string' && value.title.length <= ConversationTitleMaxLength)],
    ['systemPrompt must be a string when provided', !prompt || typeof value.systemPrompt === 'string'],
    [`systemPrompt must be at most ${ConversationSystemPromptMaxLength} characters`, !prompt || typeof value.systemPrompt !== 'string' || value.systemPrompt.length <= ConversationSystemPromptMaxLength],
  ]);
}
