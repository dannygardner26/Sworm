import type { LLMProvider, LLMMessage, LLMResponse, LLMToolDefinition } from './types.js';

export class GeminiProvider implements LLMProvider {
  readonly name: string;
  readonly type = 'gemini';
  private apiKey: string;
  private model: string;

  constructor(name: string, apiKey: string, model: string) {
    this.name = name;
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[]): Promise<LLMResponse> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(this.apiKey);

    const functionDeclarations = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const model = genAI.getGenerativeModel({
      model: this.model,
      tools: functionDeclarations ? [{ functionDeclarations }] : undefined,
    });

    // Convert to Gemini format
    const systemMsg = messages.find((m) => m.role === 'system');
    const history = messages
      .filter((m) => m.role !== 'system')
      .slice(0, -1)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const lastMsg = messages[messages.length - 1];
    const chat = model.startChat({
      history: history as any,
      systemInstruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
    });

    const result = await chat.sendMessage(lastMsg.content);
    const response = result.response;
    const text = response.text?.() ?? '';

    // Check for function calls
    const functionCalls = response.candidates?.[0]?.content?.parts
      ?.filter((p: any) => p.functionCall)
      ?.map((p: any, i: number) => ({
        id: `gemini-${Date.now()}-${i}`,
        name: p.functionCall.name,
        arguments: p.functionCall.args as Record<string, unknown>,
      }));

    return {
      content: text,
      toolCalls: functionCalls?.length ? functionCalls : undefined,
      stopReason: functionCalls?.length ? 'tool_use' : 'end_turn',
      usage: response.usageMetadata
        ? {
            inputTokens: response.usageMetadata.promptTokenCount ?? 0,
            outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
          }
        : undefined,
    };
  }
}
