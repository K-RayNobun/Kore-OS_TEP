export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  finish_reason?: string;
}

export class LLMClient {
  constructor(
    private apiKey: string,
    private baseUrl: string,
    private model: string,
  ) {}

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM error ${res.status}: ${text}`);
    }

    const json = await res.json();
    const choice = json.choices?.[0];
    return {
      content: choice?.message?.content ?? '',
      finish_reason: choice?.finish_reason,
    };
  }
}
