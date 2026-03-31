import type { LLMProvider, LLMMessage, LLMResponse, LLMToolDefinition } from './types.js';

export class BedrockProvider implements LLMProvider {
  readonly name: string;
  readonly type = 'bedrock';
  private region: string;
  private model: string;

  constructor(name: string, region: string, model: string) {
    this.name = name;
    this.region = region;
    this.model = model;
  }

  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[]): Promise<LLMResponse> {
    const { BedrockRuntimeClient, ConverseCommand } =
      await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: this.region });

    // Extract system message
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystemMsgs = messages.filter((m) => m.role !== 'system');

    // Convert messages to Bedrock Converse format
    const bedrockMessages = nonSystemMsgs.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'user' as const,
          content: [{ toolResult: { toolUseId: m.toolCallId!, content: [{ text: m.content }] } }],
        };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: m.toolCalls.map((tc) => ({
            toolUse: { toolUseId: tc.id, name: tc.name, input: tc.arguments },
          })),
        };
      }
      return { role: m.role as 'user' | 'assistant', content: [{ text: m.content }] };
    });

    const toolConfig = tools?.length
      ? {
          tools: tools.map((t) => ({
            toolSpec: {
              name: t.name,
              description: t.description,
              inputSchema: { json: t.parameters },
            },
          })),
        }
      : undefined;

    const command = new ConverseCommand({
      modelId: this.model,
      system: systemMsg ? [{ text: systemMsg.content }] : undefined,
      messages: bedrockMessages as any,
      toolConfig: toolConfig as any,
    });

    const response = await client.send(command);

    let content = '';
    const toolCalls: LLMResponse['toolCalls'] = [];

    for (const block of response.output?.message?.content ?? []) {
      if ('text' in block) content += block.text;
      if ('toolUse' in block && block.toolUse) {
        toolCalls.push({
          id: block.toolUse.toolUseId!,
          name: block.toolUse.name!,
          arguments: block.toolUse.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason:
        response.stopReason === 'tool_use'
          ? 'tool_use'
          : response.stopReason === 'max_tokens'
            ? 'max_tokens'
            : 'end_turn',
      usage: response.usage
        ? {
            inputTokens: response.usage.inputTokens ?? 0,
            outputTokens: response.usage.outputTokens ?? 0,
          }
        : undefined,
    };
  }
}
