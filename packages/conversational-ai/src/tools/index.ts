import { z } from 'zod';
import type { MemoryStore } from '../memory/MemoryStore.js';
import type { ConversationStore } from '../memory/ConversationStore.js';
import type { SkillStore } from '../skills/SkillStore.js';

export interface ToolContext {
  userId: string;
  sessionId: string;
  memoryStore: MemoryStore;
  conversationStore: ConversationStore;
  skillStore: SkillStore;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

const memoryAddSchema = z.object({
  entry: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

const profileUpdateSchema = z.object({
  tone: z.string().optional(),
  tone_score: z.record(z.number()).optional(),
  availability: z.record(z.unknown()).optional(),
  attention: z.record(z.unknown()).optional(),
  expertise: z.array(z.unknown()).optional(),
  style_notes: z.string().optional(),
});

const conversationSearchSchema = z.object({
  query: z.string().optional(),
  mode: z.enum(['discovery', 'scroll', 'browse']).optional(),
  session_id: z.string().optional(),
  around_message_id: z.number().optional(),
  limit: z.number().optional(),
});

const skillCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  definition: z.record(z.unknown()),
});

const skillExecuteSchema = z.object({
  name: z.string().min(1),
  parameters: z.record(z.unknown()).optional(),
});

export class ToolRegistry {
  private tools = new Map<string, ToolHandler>();
  private ctx!: ToolContext;

  constructor() {
    this.register('memory_add', memoryAddSchema, async (args, ctx) => {
      const parsed = memoryAddSchema.parse(args);
      const id = await ctx.memoryStore.addMemory({
        user_id: ctx.userId,
        entry: parsed.entry,
        confidence: parsed.confidence ?? 0.80,
      });
      return { success: true, data: { id } };
    });

    this.register('profile_update', profileUpdateSchema, async (args, ctx) => {
      const parsed = profileUpdateSchema.parse(args);
      const profile = await ctx.memoryStore.updateProfile(ctx.userId, parsed as any);
      return { success: true, data: profile };
    });

    this.register('conversation_search', conversationSearchSchema, async (args, ctx) => {
      const parsed = conversationSearchSchema.parse(args);
      if (parsed.mode === 'browse') {
        const sessions = await ctx.conversationStore.getRecentSessions(ctx.userId, parsed.limit ?? 20);
        return { success: true, data: { sessions } };
      }
      if (parsed.mode === 'scroll' && parsed.session_id && parsed.around_message_id) {
        // Simplified: return session context
        const msgs = await ctx.conversationStore.getSession(ctx.userId, parsed.session_id);
        return { success: true, data: { messages: msgs } };
      }
      const results = await ctx.conversationStore.search(ctx.userId, parsed.query ?? '', parsed.limit ?? 10);
      return { success: true, data: { results } };
    });

    this.register('skill_create', skillCreateSchema, async (args, ctx) => {
      const parsed = skillCreateSchema.parse(args);
      const id = await ctx.skillStore.create({
        user_id: ctx.userId,
        name: parsed.name,
        description: parsed.description,
        definition: parsed.definition,
      });
      return { success: true, data: { id } };
    });

    this.register('skill_list', z.object({}), async (args, ctx) => {
      const skills = await ctx.skillStore.listForUser(ctx.userId);
      return { success: true, data: { skills } };
    });

    this.register('skill_execute', skillExecuteSchema, async (args, ctx) => {
      const parsed = skillExecuteSchema.parse(args);
      const skills = await ctx.skillStore.listForUser(ctx.userId);
      const skill = skills.find((s) => s.name === parsed.name);
      if (!skill) return { success: false, error: `Skill not found: ${parsed.name}` };
      await ctx.skillStore.incrementUse(skill.id!);
      return { success: true, data: { skill, parameters: parsed.parameters } };
    });
  }

  register(name: string, schema: z.ZodTypeAny, handler: ToolHandler): void {
    this.tools.set(name, handler);
  }

  setContext(ctx: ToolContext): void {
    this.ctx = ctx;
  }

  getToolSchemas(): { name: string; description: string }[] {
    return Array.from(this.tools.keys()).map((name) => ({
      name,
      description: `Tool: ${name}`,
    }));
  }

  async dispatch(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const handler = this.tools.get(name);
    if (!handler) return { success: false, error: `Unknown tool: ${name}` };
    try {
      return await handler(args, this.ctx);
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
