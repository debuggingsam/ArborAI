import { PrismaClient, NodeRole, NodeStatus } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const workspace = await prisma.conversation.create({ data: { title: 'ArborAI workspace', systemPrompt: 'Answer clearly and concisely.' } });
  const topic = await prisma.topic.create({ data: { conversationId: workspace.id, title: 'Building ArborAI', description: 'Product and architecture decisions.' } });
  const subtopic = await prisma.topic.create({ data: { conversationId: workspace.id, parentTopicId: topic.id, title: 'Refresh-token storage', description: 'Authentication storage options.' } });
  const independent = await prisma.topic.create({ data: { conversationId: workspace.id, title: 'Preparing for interviews', contextEnabled: false } });
  const user = await prisma.conversationNode.create({ data: { conversationId: workspace.id, topicId: topic.id, role: NodeRole.user, content: 'How should authentication work?', status: NodeStatus.completed } });
  const answerA = await prisma.conversationNode.create({ data: { conversationId: workspace.id, topicId: topic.id, parentId: user.id, role: NodeRole.assistant, content: 'Use short-lived access tokens and refresh tokens.', status: NodeStatus.completed } });
  await prisma.conversationNode.create({ data: { conversationId: workspace.id, topicId: topic.id, parentId: user.id, role: NodeRole.assistant, content: 'Use a server-managed session with rotating credentials.', status: NodeStatus.completed, contextEnabled: false } });
  await prisma.conversationNode.create({ data: { conversationId: workspace.id, topicId: subtopic.id, role: NodeRole.user, content: 'Should tokens use cookies?', status: NodeStatus.completed, parentId: null } });
  await prisma.conversationNode.create({ data: { conversationId: workspace.id, topicId: independent.id, role: NodeRole.user, content: 'Help me explain this project.', status: NodeStatus.completed } });
  await prisma.topic.update({ where: { id: topic.id }, data: { activeNodeId: answerA.id } });
  await prisma.conversation.update({ where: { id: workspace.id }, data: { activeTopicId: topic.id } });
  console.log(`Seeded workspace ${workspace.id}`);
} finally { await prisma.$disconnect(); }
