import type { LLMProvider, LLMMessage, LLMResponse, LLMToolDefinition } from './types.js';

export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  readonly type = 'openai';
  private apiKey: string;
  private model: string;
  private baseUrl?: string;

  constructor(name: string, apiKey: string, model: string, baseUrl?: string) {
    this.name = name;
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[]): Promise<LLMResponse> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseUrl });

    const openaiMessages = messages.map(m => {
      if (m.role === 'tool') {
        return { role: 'tool' as const, tool_call_id: m.toolCallId!, content: m.content };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        };
      }
      return { role: m.role, content: m.content };
    });

    const openaiTools = tools?.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const response = await client.chat.completions.create({
      model: this.model,
      messages: openaiMessages as any,
      tools: openaiTools,
    });

    const choice = response.choices[0];
    const toolCalls = choice.message.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: choice.message.content ?? '',
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      stopReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
      usage: response.usage ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens } : undefined,
    };
  }
}
