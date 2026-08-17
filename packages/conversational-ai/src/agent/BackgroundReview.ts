import { MemoryStore } from '../memory/MemoryStore.js';
import { ConversationStore } from '../memory/ConversationStore.js';
import { SkillStore } from '../skills/SkillStore.js';
import { LLMClient } from '../llm/client.js';

export class BackgroundReview {
  private running = false;

  constructor(
    private memoryStore: MemoryStore,
    private conversationStore: ConversationStore,
    private skillStore: SkillStore,
    private llm: LLMClient,
  ) {}

  async review(userId: string, sessionId: string, userMessage: string, assistantMessage: string): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const lower = `${userMessage} ${assistantMessage}`.toLowerCase();

      if (lower.includes('remember') || lower.includes('prefer')) {
        const entry = userMessage.replace(/i want to remember/i, '').replace(/i like/i, '').trim();
        if (entry) {
          await this.memoryStore.addMemory({
            user_id: userId,
            entry: `User preference: ${entry}`,
            confidence: 0.90,
            source: 'background_review',
          });
        }
      }

      if (lower.includes('tone') || lower.includes('formal') || lower.includes('casual')) {
        const tone = lower.includes('formal') ? 'formal' : lower.includes('casual') ? 'casual' : 'professional';
        await this.memoryStore.updateProfile(userId, {
          tone,
          tone_score: {
            formal: tone === 'formal' ? 0.85 : tone === 'casual' ? 0.25 : 0.50,
            casual: tone === 'casual' ? 0.85 : tone === 'formal' ? 0.25 : 0.50,
          },
        });
      }

      if (lower.includes('expertise') || lower.includes('expert')) {
        const subjects = ['kubernetes', 'docker', 'python', 'networking'];
        const matched = subjects.find((s) => lower.includes(s));
        if (matched) {
          await this.memoryStore.addMemory({
            user_id: userId,
            entry: `User expertise: ${matched}`,
            confidence: 0.85,
            source: 'background_review',
          });
        }
      }

      if (lower.includes('availability') || lower.includes('9am') || lower.includes('hours')) {
        await this.memoryStore.updateProfile(userId, {
          availability: { timezone: 'UTC', windows: [{ days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], start: '09:00', end: '17:00' }] },
        });
      }
    } catch (err) {
      console.error('[background_review] failed:', err);
    } finally {
      this.running = false;
    }
  }
}
