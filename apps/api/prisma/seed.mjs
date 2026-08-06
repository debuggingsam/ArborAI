import {
  GenerationMode,
  GenerationStatus,
  NodeRole,
  NodeStatus,
  PrismaClient,
  TopicCreatedBy,
  TreeMakerRunStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

try {
  const workspace = await prisma.conversation.create({
    data: { title: 'ArborAI workspace', systemPrompt: 'Answer clearly and concisely.' },
  });
  const product = await prisma.topic.create({
    data: {
      conversationId: workspace.id,
      title: 'Building ArborAI',
      description: 'Product and architecture decisions.',
      createdBy: TopicCreatedBy.user,
      contextCapsule: { summary: 'ArborAI is a topic-aware workspace.', facts: [], decisions: [], constraints: [], openQuestions: [], sourceTopicIds: [], sourceNodeIds: [] },
      capsuleVersion: 1,
      capsuleUpdatedAt: new Date(),
    },
  });
  const authentication = await prisma.topic.create({
    data: { conversationId: workspace.id, parentTopicId: product.id, title: 'Authentication', description: 'Access and refresh token design.', createdBy: TopicCreatedBy.user },
  });
  const refreshTokens = await prisma.topic.create({
    data: { conversationId: workspace.id, parentTopicId: authentication.id, title: 'Refresh-token storage', description: 'Cookie and rotation options.', createdBy: TopicCreatedBy.user },
  });
  const interviews = await prisma.topic.create({
    data: { conversationId: workspace.id, title: 'Preparing for interviews', contextEnabled: false, createdBy: TopicCreatedBy.user },
  });

  const user = await prisma.conversationNode.create({
    data: { conversationId: workspace.id, topicId: product.id, role: NodeRole.user, content: 'How should ArborAI organize knowledge?', status: NodeStatus.completed },
  });
  const answer = await prisma.conversationNode.create({
    data: { conversationId: workspace.id, topicId: product.id, parentId: user.id, role: NodeRole.assistant, content: 'Use independent topics, nested subtopics, and separate message branches.', status: NodeStatus.completed, pinned: true },
  });
  const followUp = await prisma.conversationNode.create({
    data: { conversationId: workspace.id, topicId: product.id, parentId: answer.id, role: NodeRole.user, content: 'How do alternative answers fit?', status: NodeStatus.completed },
  });
  const answerA = await prisma.conversationNode.create({
    data: { conversationId: workspace.id, topicId: product.id, parentId: followUp.id, role: NodeRole.assistant, content: 'They are sibling assistant responses for one user message.', status: NodeStatus.completed },
  });
  await prisma.conversationNode.create({
    data: { conversationId: workspace.id, topicId: product.id, parentId: followUp.id, role: NodeRole.assistant, content: 'Regeneration creates a comparable sibling response.', status: NodeStatus.completed, contextEnabled: false },
  });
  const refreshQuestion = await prisma.conversationNode.create({
    data: { conversationId: workspace.id, topicId: refreshTokens.id, role: NodeRole.user, content: 'Should refresh tokens use cookies?', status: NodeStatus.completed },
  });
  const refreshAnswer = await prisma.conversationNode.create({
    data: { conversationId: workspace.id, topicId: refreshTokens.id, parentId: refreshQuestion.id, role: NodeRole.assistant, content: 'Use HTTP-only secure cookies with rotation.', status: NodeStatus.completed },
  });
  await prisma.conversationNode.create({
    data: { conversationId: workspace.id, topicId: interviews.id, role: NodeRole.user, content: 'Help me explain this project.', status: NodeStatus.completed },
  });

  const treeMakerRun = await prisma.treeMakerRun.create({
    data: {
      conversationId: workspace.id,
      newPrompt: refreshQuestion.content,
      activeTopicId: refreshTokens.id,
      inputTreeIndex: { workspaceId: workspace.id, topics: [{ id: product.id, parentTopicId: null }, { id: authentication.id, parentTopicId: product.id }, { id: refreshTokens.id, parentTopicId: authentication.id }] },
      outputDecision: { action: 'continue_topic', topicId: refreshTokens.id, anchorNodeId: refreshQuestion.id },
      provider: 'mock', model: 'mock-tree-maker', confidence: 0.95, status: TreeMakerRunStatus.completed,
    },
  });
  const generation = await prisma.generation.create({
    data: {
      conversationId: workspace.id, topicId: refreshTokens.id, treeMakerRunId: treeMakerRun.id,
      userNodeId: refreshQuestion.id, assistantNodeId: refreshAnswer.id,
      mode: GenerationMode.auto_route, provider: 'mock', model: 'mock-answer', status: GenerationStatus.completed,
      inputTokenCount: 12, outputTokenCount: 9, completedAt: new Date(),
    },
  });
  await prisma.generationContextSnapshot.create({
    data: {
      generationId: generation.id,
      orderedModelMessages: [{ role: 'user', content: refreshQuestion.content, sourceType: 'message', sourceId: refreshQuestion.id }],
      includedTopicIds: [refreshTokens.id], includedNodeIds: [refreshQuestion.id], excludedTopicIds: [interviews.id], excludedNodeIds: [],
      exclusions: [{ code: 'topic_context_disabled', topicId: interviews.id }], warnings: [], estimatedInputTokens: 12, maxInputTokens: 8000,
    },
  });
  await prisma.topic.update({ where: { id: product.id }, data: { activeNodeId: answerA.id } });
  await prisma.topic.update({ where: { id: refreshTokens.id }, data: { activeNodeId: refreshAnswer.id } });
  await prisma.conversation.update({ where: { id: workspace.id }, data: { activeTopicId: product.id } });
  console.log(`Seeded workspace ${workspace.id}`);
} finally {
  await prisma.$disconnect();
}
