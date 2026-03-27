export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  readonly name: string;
  readonly type: string;
  chat(messages: LLMMessage[], tools?: LLMToolDefinition[]): Promise<LLMResponse>;
}

export interface ProviderConfig {
  type: string;
  apiKey?: string;
  baseUrl?: string;
  region?: string;
  deployment?: string;
  defaultModel?: string;
}
