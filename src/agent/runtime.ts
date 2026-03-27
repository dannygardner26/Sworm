import type { AgentConfig, AgentTool } from './types.js';

// Import types from providers — these will resolve after merge
// For now, define locally to avoid import errors
interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface LLMProvider {
  readonly name: string;
  chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
  ): Promise<{
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  }>;
}

export interface AgentOutput {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done';
  content: string;
}

export type AgentOutputHandler = (output: AgentOutput) => void;

export class AgentRuntime {
  private config: AgentConfig;
  private provider: LLMProvider;
  private tools: AgentTool[];
  private outputHandler: AgentOutputHandler;
  private messages: LLMMessage[] = [];
  private running = false;

  constructor(
    config: AgentConfig,
    provider: LLMProvider,
    tools: AgentTool[],
    outputHandler: AgentOutputHandler,
  ) {
    this.config = config;
    this.provider = provider;
    this.tools = tools;
    this.outputHandler = outputHandler;
  }

  async run(): Promise<void> {
    this.running = true;
    const maxIterations = this.config.maxIterations ?? 50;

    // Build system prompt
    const systemPrompt =
      this.config.systemPrompt ??
      `You are an AI coding agent working in: ${this.config.workingDir}\n` +
        `You have access to tools for reading/writing files and running shell commands.\n` +
        `Complete the user's request by using tools as needed. When done, provide a summary.`;

    this.messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: this.config.userPrompt },
    ];

    const toolDefs: LLMToolDefinition[] = this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    for (let i = 0; i < maxIterations && this.running; i++) {
      try {
        const response = await this.provider.chat(this.messages, toolDefs);

        // Handle text content
        if (response.content) {
          this.outputHandler({ type: 'text', content: response.content });
        }

        // If no tool calls, we're done
        if (
          !response.toolCalls ||
          response.toolCalls.length === 0 ||
          response.stopReason === 'end_turn'
        ) {
          this.outputHandler({ type: 'done', content: 'Agent completed.' });
          break;
        }

        // Add assistant message with tool calls
        this.messages.push({
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls,
        });

        // Execute each tool call
        for (const toolCall of response.toolCalls) {
          this.outputHandler({
            type: 'tool_call',
            content: `${toolCall.name}(${JSON.stringify(toolCall.arguments)})`,
          });

          const tool = this.tools.find((t) => t.name === toolCall.name);
          if (!tool) {
            const errorMsg = `Unknown tool: ${toolCall.name}`;
            this.messages.push({ role: 'tool', toolCallId: toolCall.id, content: errorMsg });
            this.outputHandler({ type: 'error', content: errorMsg });
            continue;
          }

          const result = await tool.execute(toolCall.arguments);
          const resultContent = result.error
            ? `Error: ${result.error}\nOutput: ${result.output}`
            : result.output;

          this.messages.push({ role: 'tool', toolCallId: toolCall.id, content: resultContent });
          this.outputHandler({ type: 'tool_result', content: resultContent.substring(0, 500) });
        }
      } catch (e) {
        const errorMsg = `Agent error: ${e instanceof Error ? e.message : String(e)}`;
        this.outputHandler({ type: 'error', content: errorMsg });
        break;
      }
    }

    this.running = false;
  }

  stop(): void {
    this.running = false;
  }
}
