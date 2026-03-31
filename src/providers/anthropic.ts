import type { LLMProvider, LLMMessage, LLMResponse, LLMToolDefinition } from './types.js';

export class AnthropicProvider implements LLMProvider {
  readonly name: string;
  readonly type = 'anthropic';
  private apiKey: string;
  private model: string;

  constructor(name: string, apiKey: string, model: string) {
    this.name = name;
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[]): Promise<LLMResponse> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.apiKey });

    // Separate system message
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystemMsgs = messages.filter((m) => m.role !== 'system');

    // Convert messages to Anthropic format
    const anthropicMessages = nonSystemMsgs.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'user' as const,
          content: [
            { type: 'tool_result' as const, tool_use_id: m.toolCallId!, content: m.content },
          ],
        };
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant' as const,
          content: m.toolCalls.map((tc) => ({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          })),
        };
      }
      return { role: m.role as 'user' | 'assistant', content: m.content };
    });

    // Convert tools to Anthropic format
    const anthropicTools = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Record<string, unknown>,
    }));

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemMsg?.content,
      messages: anthropicMessages,
      tools: anthropicTools,
    });

    // Parse response
    let content = '';
    const toolCalls: LLMResponse['toolCalls'] = [];

    for (const block of response.content) {
      if (block.type === 'text') content += block.text;
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason:
        response.stop_reason === 'tool_use'
          ? 'tool_use'
          : response.stop_reason === 'max_tokens'
            ? 'max_tokens'
            : 'end_turn',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
