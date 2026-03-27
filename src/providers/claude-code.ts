import type { LLMProvider, LLMMessage, LLMResponse, LLMToolDefinition } from './types.js';

export class ClaudeCodeProvider implements LLMProvider {
  readonly name: string;
  readonly type = 'claude-code';

  constructor(name: string) {
    this.name = name;
  }

  async chat(_messages: LLMMessage[], _tools?: LLMToolDefinition[]): Promise<LLMResponse> {
    // This provider is not used for direct chat — the AIAgentWorm
    // detects type === 'claude-code' and spawns the Claude Code CLI instead.
    throw new Error(
      'ClaudeCodeProvider does not support direct chat(). ' +
      'The AIAgentWorm should detect this provider type and delegate to the Claude Code CLI.'
    );
  }
}
