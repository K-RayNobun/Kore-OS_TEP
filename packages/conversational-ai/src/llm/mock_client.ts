import { LLMClient } from './client.ts';
import type { LLMMessage } from './client.ts';

export class MockLLMClient extends LLMClient {
  constructor() {
    super('mock', 'mock', 'mock-model');
  }

  async chat(messages: LLMMessage[]): Promise<{ content: string; finish_reason?: string }> {
    const last = messages[messages.length - 1];
    const lower = last.content.toLowerCase();

    if (lower.includes('[tool_result]')) {
      const resultMatch = last.content.match(/\[TOOL_RESULT\]\s*\w+:\s*(\{.*\})/s);
      if (resultMatch) {
        try {
          const result = JSON.parse(resultMatch[1]);
          if (result.success) {
            return { content: 'The operation completed successfully. Is there anything else I can help with?', finish_reason: 'stop' };
          }
          return { content: `I encountered an issue: ${result.error || 'unknown error'}. Would you like me to retry?`, finish_reason: 'stop' };
        } catch {
          // fall through to generic
        }
      }
      return { content: 'The tool executed. Let me know if you need anything else.', finish_reason: 'stop' };
    }

    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
      return { content: 'Hello! How can I help you today?', finish_reason: 'stop' };
    }
    if (lower.includes('status') || lower.includes('how are you')) {
      return { content: 'All systems are operational. CPU usage is normal and memory is within expected bounds.', finish_reason: 'stop' };
    }
    if (lower.includes('report') || lower.includes('weekly')) {
      return { content: 'I will generate that report for you. [TOOL_CALL] skill_execute {"name":"generate_weekly_report","parameters":{"week_start":"2026-07-14"}}', finish_reason: 'stop' };
    }
    if (lower.includes('remember') || lower.includes('prefer')) {
      return { content: 'Got it, I have noted your preference. [TOOL_CALL] memory_add {"entry":"User prefers concise responses","confidence":0.95}', finish_reason: 'stop' };
    }
    if (lower.includes('tone') || lower.includes('formal') || lower.includes('casual')) {
      return { content: 'Adjusting my tone now. [TOOL_CALL] profile_update {"tone":"professional","tone_score":{"formal":0.80,"casual":0.20}}', finish_reason: 'stop' };
    }
    if (lower.includes('search') || lower.includes('find') || lower.includes('look up')) {
      return { content: 'Searching our conversation history... [TOOL_CALL] conversation_search {"query":"' + last.content.slice(0, 40) + '","mode":"discovery"}', finish_reason: 'stop' };
    }
    if (lower.includes('skill') || lower.includes('create')) {
      return { content: 'I will create a new skill for that. [TOOL_CALL] skill_create {"name":"custom_workflow","description":"User-defined automation","definition":{"steps":["fetch","transform","store"]}}', finish_reason: 'stop' };
    }
    if (lower.includes('help') || lower.includes('what can you do')) {
      return { content: 'I can manage memories, run skills, search past conversations, and adapt to your preferences. Try asking me to remember something or run a weekly report.', finish_reason: 'stop' };
    }
    if (lower.includes('thank')) {
      return { content: 'You are welcome! Let me know if there is anything else.', finish_reason: 'stop' };
    }

    const fallbacks = [
      'Understood. I have processed your request and updated my context accordingly.',
      'Noted. Is there anything specific you would like me to focus on?',
      'I hear you. I will keep that in mind for future interactions.',
      'Acknowledged. I am adjusting my approach based on your input.',
    ];
    const idx = last.content.length % fallbacks.length;
    return { content: fallbacks[idx], finish_reason: 'stop' };
  }
}
