import 'dotenv/config';
import { DatabaseClient } from './db/client.js';
import { MemoryStore } from './memory/MemoryStore.js';
import { ConversationStore } from './memory/ConversationStore.js';
import { SkillStore } from './skills/SkillStore.js';
import { ToolRegistry } from './tools/index.js';
import { MockLLMClient } from './llm/mock_client.js';
import { LLMClient } from './llm/client.js';
import { ConversationLoop } from './agent/ConversationLoop.js';
import { BackgroundReview } from './agent/BackgroundReview.js';
import { Curator } from './skills/Curator.js';

const pgUser = process.env.PGUSER;
const pgPassword = process.env.PGPASSWORD;
const pgHost = process.env.PGHOST;
const pgPort = process.env.PGPORT;
const pgDatabase = process.env.PGDATABASE;

const connectionString = (pgUser && pgPassword && pgHost && pgPort && pgDatabase)
  ? `postgresql://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/${pgDatabase}`
  : undefined;

export async function createConversationalAI() {
  const db = new DatabaseClient(connectionString);
  await db.connect();

  const userId = process.env.CONVERSATIONAL_AI_USER_ID ?? 'default-user';
  const sessionId = process.env.CONVERSATIONAL_AI_SESSION_ID ?? `session-${Date.now()}`;

  const memoryStore = new MemoryStore(db);
  const conversationStore = new ConversationStore(db);
  const skillStore = new SkillStore(db);
  const toolRegistry = new ToolRegistry();

  const useMock = !process.env.ZAI_API_KEY || process.env.ZAI_API_KEY === 'your_zai_api_key_here';
  const llm = useMock
    ? new MockLLMClient()
    : new LLMClient(process.env.ZAI_API_KEY!, process.env.ZAI_BASE_URL!, process.env.ZAI_MODEL!);

  const loop = new ConversationLoop({
    userId,
    sessionId,
    llm,
    memoryStore,
    conversationStore,
    skillStore,
    toolRegistry,
    maxIterations: 10,
  });

  const review = new BackgroundReview(memoryStore, conversationStore, skillStore, llm);
  const curator = new Curator(skillStore);
  curator.start();

  return {
    db,
    loop,
    review,
    memoryStore,
    conversationStore,
    skillStore,
    userId,
    sessionId,
    processUserMessage: (msg: string) => loop.processUserMessage(msg),
    async shutdown() {
      curator.start = () => {}; // stop interval
      await db.disconnect();
    },
  };
}

// CLI entrypoint
if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  createConversationalAI()
    .then((ai) => {
      (global as any).conversationalAI = ai;
      console.log(`[conversational-ai] ready. userId=${ai.userId} sessionId=${ai.sessionId}`);
    })
    .catch((err) => {
      console.error('[conversational-ai] fatal:', err);
      process.exit(1);
    });
}
