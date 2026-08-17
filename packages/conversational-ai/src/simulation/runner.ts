import 'dotenv/config';
import { createConversationalAI } from '../index.js';

const patterns = [
  { prefix: 'Hey', bodies: ['what is the system status?', 'how are you doing today?', 'can you give me a quick update?', 'are all services running?'] },
  { prefix: 'Please', bodies: ['generate the weekly report for this week.', 'create a summary of last week', 'run the server audit', 'compile the metrics report'] },
  { prefix: 'I want', bodies: ['to remember that I prefer concise answers.', 'to remember my availability is 9am-5pm weekdays.', 'to remember I like formal tone in reports.', 'to remember I am a Kubernetes expert.', 'to remember I prefer async communication.'] },
  { prefix: 'Search', bodies: ['for previous reports about server status', 'for conversations about weekly summaries', 'for my availability preferences', 'for Kubernetes discussions'] },
  { prefix: 'Create', bodies: ['a new skill called deploy_checklist', 'a skill named incident_response', 'a skill named data_backup_runner'] },
  { prefix: 'Thanks', bodies: ['for the help.', 'that was useful.', 'I appreciate it.', 'good work.'] },
  { prefix: 'Help', bodies: ['me understand what you can do.', 'me list available skills.', 'me find my recent conversations.', 'me check my profile settings.'] },
  { prefix: 'My tone', bodies: ['should be more casual.', 'should be more formal.', 'is just right, keep it.', 'needs to be professional.'] },
  { prefix: 'Check', bodies: ['my expertise in Kubernetes', 'my expertise in Docker', 'my expertise in Python', 'my expertise in networking'] },
  { prefix: 'Run', bodies: ['the health check', 'the backup procedure', 'the security audit', 'the performance benchmark'] },
];

async function simulate() {
  const ai = await createConversationalAI();
  const { loop, review, memoryStore, conversationStore, skillStore, userId, sessionId, processUserMessage } = ai;
  const totalMessages = 120;
  let turn = 0;

  while (turn < totalMessages) {
    const pattern = patterns[turn % patterns.length];
    const body = pattern.bodies[turn % pattern.bodies.length];
    const variation = Math.floor(turn / patterns.length) + 1;
    const message = `${pattern.prefix} ${body} (variation ${variation})`;

    try {
      const response = await processUserMessage(message);
      review.review(userId, sessionId, message, response).catch(() => {});
    } catch (err) {
      console.error(`[turn ${turn}] error:`, err);
    }

    turn++;
    if (turn % 20 === 0) {
      const memories = await memoryStore.getMemories(userId, 5);
      const profile = await memoryStore.getOrCreateProfile(userId);
      const skills = await skillStore.listForUser(userId);
      console.log(`checkpoint turn=${turn} memories=${memories.length} tone=${profile.tone} skills=${skills.map((s) => s.name).join(',') || 'none'}`);
    }
  }

  console.log('\n=== simulation complete ===');
  const allMemories = await memoryStore.getMemories(userId, 100);
  const allSkills = await skillStore.listForUser(userId, true);
  const sessions = await conversationStore.getRecentSessions(userId, 10);
  console.log(`total memories: ${allMemories.length}`);
  console.log(`total skills: ${allSkills.length}`);
  console.log(`sessions: ${sessions.join(', ')}`);

  await ai.shutdown();
}

simulate().catch((err) => {
  console.error('[simulation] fatal:', err);
  process.exit(1);
});
