import { PrismaClient, NodeRole, NodeStatus } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const conversation = await prisma.conversation.create({
    data: {
      title: 'ArborAI seed conversation',
      systemPrompt: 'Answer clearly and concisely.',
      nodes: { create: { role: NodeRole.user, content: 'What is a conversation tree?', status: NodeStatus.completed } },
    },
    include: { nodes: true },
  });
  const prompt = conversation.nodes[0];
  const answer = await prisma.conversationNode.create({ data: { conversationId: conversation.id, parentId: prompt.id, role: NodeRole.assistant, content: 'A conversation tree preserves alternate paths from earlier messages.', status: NodeStatus.completed } });
  await prisma.conversationNode.createMany({ data: [
    { conversationId: conversation.id, parentId: prompt.id, role: NodeRole.assistant, content: 'It is a branching history of prompts and responses.', status: NodeStatus.completed },
    { conversationId: conversation.id, parentId: answer.id, role: NodeRole.user, content: 'Show me another perspective.', status: NodeStatus.completed },
  ] });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { activeNodeId: answer.id } });
  console.log(`Seeded conversation ${conversation.id}`);
} finally { await prisma.$disconnect(); }
