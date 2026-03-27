import type { LLMProvider, LLMMessage, LLMResponse, LLMToolDefinition } from './types.js';

export class OllamaProvider implements LLMProvider {
  readonly name: string;
  readonly type = 'ollama';
  private model: string;
  private baseUrl: string;

  constructor(name: string, model: string, baseUrl: string) {
    this.name = name;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[]): Promise<LLMResponse> {
    const ollamaMessages = messages.map(m => {
      if (m.role === 'tool') {
        return { role: 'tool' as const, content: m.content };
      }
      return { role: m.role, content: m.content };
    });

    const ollamaTools = tools?.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: ollamaMessages,
        tools: ollamaTools,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json() as any;
    const msg = data.message;

    const toolCalls = msg.tool_calls?.map((tc: any, i: number) => ({
      id: `ollama-${Date.now()}-${i}`,
      name: tc.function.name,
      arguments: tc.function.arguments as Record<string, unknown>,
    }));

    return {
      content: msg.content ?? '',
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      stopReason: toolCalls?.length ? 'tool_use' : data.done ? 'end_turn' : 'max_tokens',
      usage: data.eval_count ? { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 } : undefined,
    };
  }
}
