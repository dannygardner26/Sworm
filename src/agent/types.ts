export interface AgentToolResult {
  output: string;
  error?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute(args: Record<string, unknown>): Promise<AgentToolResult>;
}

export interface AgentConfig {
  provider: string;
  model?: string;
  systemPrompt?: string;
  userPrompt: string;
  workingDir: string;
  maxIterations?: number; // default: 50
  maxTokens?: number; // default: 4096
}
