import { MemoryStore } from '../memory/MemoryStore.js';
import { ConversationStore } from '../memory/ConversationStore.js';
import { SkillStore } from '../skills/SkillStore.js';
import { SystemPromptBuilder } from './SystemPrompt.ts';
import { ToolRegistry } from '../tools/index.js';
import { LLMClient } from '../llm/client.js';

export interface ConversationLoopOptions {
  userId: string;
  sessionId: string;
  llm: LLMClient;
  memoryStore: MemoryStore;
  conversationStore: ConversationStore;
  skillStore: SkillStore;
  toolRegistry: ToolRegistry;
  onTurnComplete?: (userMsg: string, assistantMsg: string) => void;
  maxIterations?: number;
}

export class ConversationLoop {
  private maxIterations: number;
  private running = false;

  constructor(private opts: ConversationLoopOptions) {
    this.maxIterations = opts.maxIterations ?? 10;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const promptBuilder = new SystemPromptBuilder(
      this.opts.memoryStore,
      this.opts.conversationStore,
    );

    while (this.running) {
      const systemPrompt = await promptBuilder.build(
        this.opts.userId,
        this.opts.sessionId,
      );

      this.opts.toolRegistry.setContext({
        userId: this.opts.userId,
        sessionId: this.opts.sessionId,
        memoryStore: this.opts.memoryStore,
        conversationStore: this.opts.conversationStore,
        skillStore: this.opts.skillStore,
      });
    }
  }

  async processUserMessage(userMessage: string): Promise<string> {
    const promptBuilder = new SystemPromptBuilder(
      this.opts.memoryStore,
      this.opts.conversationStore,
    );
    const systemPrompt = await promptBuilder.build(this.opts.userId, this.opts.sessionId);

    await this.opts.conversationStore.append({
      user_id: this.opts.userId,
      session_id: this.opts.sessionId,
      role: 'user',
      content: userMessage,
    });

    this.opts.toolRegistry.setContext({
      userId: this.opts.userId,
      sessionId: this.opts.sessionId,
      memoryStore: this.opts.memoryStore,
      conversationStore: this.opts.conversationStore,
      skillStore: this.opts.skillStore,
    });

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    let iterations = 0;
    let finalResponse = '';

    while (iterations < this.maxIterations) {
      iterations++;
      const llmResponse = await this.opts.llm.chat(messages);
      const content = llmResponse.content;

      if (!content.includes('[TOOL_CALL]')) {
        finalResponse = content || 'I processed your request.';
        break;
      }

      const toolCallMatch = content.match(/\[TOOL_CALL\]\s*(\w+)\s*(.*)/);
      if (!toolCallMatch) {
        finalResponse = content;
        break;
      }

      const toolName = toolCallMatch[1];
      const toolArgsRaw = toolCallMatch[2]?.trim() || '{}';
      let toolArgs: Record<string, unknown> = {};
      try {
        toolArgs = JSON.parse(toolArgsRaw);
      } catch {
        toolArgs = { raw: toolArgsRaw };
      }

      const toolResult = await this.opts.toolRegistry.dispatch(toolName, toolArgs);

      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: `[TOOL_RESULT]\n${toolName}: ${JSON.stringify(toolResult)}`,
      });
    }

    if (!finalResponse) {
      finalResponse = 'Done.';
    }

    await this.opts.conversationStore.append({
      user_id: this.opts.userId,
      session_id: this.opts.sessionId,
      role: 'assistant',
      content: finalResponse,
    });

    if (this.opts.onTurnComplete) {
      this.opts.onTurnComplete(userMessage, finalResponse);
    }

    return finalResponse;
  }

  stop(): void {
    this.running = false;
  }
}
