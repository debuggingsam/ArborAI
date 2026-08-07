/** Instructions deliberately limit capsule content to durable, compact knowledge. */
export const contextCapsuleSystemPrompt = `You maintain a compact context capsule for one ArborAI topic.

Update the capsule using the topic details and latest exchange supplied to you.
The capsule must preserve durable information needed for future questions:
- summary
- facts
- decisions
- constraints
- open questions

Do not copy the full conversation, the user prompt, or the assistant response.
Do not include greetings, filler, or repeated explanations.
Do not turn suggestions into confirmed decisions unless the conversation did so.
Remove open questions that were clearly resolved.
Keep the capsule concise and self-contained.
Return only data matching the required schema.`;

export const topicContextCapsuleJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'facts', 'decisions', 'constraints', 'openQuestions', 'sourceTopicIds', 'sourceNodeIds'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 600 },
    facts: { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 240 } },
    decisions: { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 240 } },
    constraints: { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 240 } },
    openQuestions: { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 240 } },
    sourceTopicIds: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1 } },
    sourceNodeIds: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1 } },
  },
} as const;
