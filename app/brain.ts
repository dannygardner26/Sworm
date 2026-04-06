/**
 * Sworm Brain — LLM-powered command interpretation and execution
 * Uses Claude Sonnet 4.6 via AWS Bedrock.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { TOOL_DEFINITIONS, executeTool, type BrainContext, type ToolDefinition } from './brain-tools';

const MODEL_ID = 'us.anthropic.claude-sonnet-4-6-v1:0';
const MAX_ITERATIONS = 10;
const TIMEOUT_MS = 30000;

interface Message {
  role: 'user' | 'assistant';
  content: any[];
}

export class SwormBrain {
  private ctx: BrainContext;
  private history: Message[] = [];
  private onStatus: (type: string, detail?: string) => void;
  private client: BedrockRuntimeClient;

  constructor(ctx: BrainContext, onStatus: (type: string, detail?: string) => void) {
    this.ctx = ctx;
    this.onStatus = onStatus;
    this.client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }

  async process(userText: string): Promise<string> {
    this.onStatus('thinking');
    this.ctx.log(`[Brain] Processing: "${userText}"`);

    const systemPrompt = await this.buildSystemPrompt();
    this.history.push({ role: 'user', content: [{ text: userText }] });

    if (this.history.length > 20) {
      this.history = this.history.slice(-20);
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Brain timeout')), TIMEOUT_MS),
    );

    try {
      const result = await Promise.race([this.runLoop(systemPrompt), timeout]);
      this.ctx.log(`[Brain] Done: "${result}"`);
      return result;
    } catch (e) {
      const err = `Brain error: ${e instanceof Error ? e.message : e}`;
      this.ctx.log(`[Brain] ${err}`);
      this.onStatus('error', err);
      return err;
    }
  }

  private async runLoop(systemPrompt: string): Promise<string> {
    const toolConfig = {
      tools: TOOL_DEFINITIONS.map((t: ToolDefinition) => ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.parameters as Record<string, any> },
        },
      } as any)),
    };

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const cmd = new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: systemPrompt }],
        messages: this.history,
        toolConfig,
        inferenceConfig: { temperature: 0.2, maxTokens: 1024 },
      });

      const response = await this.client.send(cmd);
      const output = response.output?.message;
      if (!output) throw new Error('Empty response from Bedrock');

      const assistantContent = output.content ?? [];
      this.history.push({ role: 'assistant', content: assistantContent });

      // Check for tool use
      const toolUses = assistantContent.filter((b: any) => b.toolUse);
      if (toolUses.length > 0) {
        const toolResults: any[] = [];
        for (const block of toolUses) {
          const tc = block.toolUse!;
          const tcName = tc.name ?? '';
          const tcInput = (tc.input ?? {}) as Record<string, unknown>;
          const tcId = tc.toolUseId ?? tcName;
          this.onStatus('tool-call', `${tcName}: ${summarizeArgs(tcInput)}`);
          this.ctx.log(`[Brain] Tool: ${tcName}(${JSON.stringify(tcInput)})`);
          const result = await executeTool(tcName, tcInput, this.ctx);
          toolResults.push({
            toolResult: {
              toolUseId: tcId,
              content: [{ text: result.error ? `Error: ${result.error}` : result.output }],
            },
          });
        }
        this.history.push({ role: 'user', content: toolResults });
        continue;
      }

      // Text response
      const text = assistantContent.find((b: any) => b.text)?.text || 'Done';
      this.onStatus('result', text);
      return text;
    }

    return 'Reached maximum iterations';
  }

  private async buildSystemPrompt(): Promise<string> {
    const panes = await this.ctx.getPanes();
    const paneList = panes.length
      ? panes.map((p: any) => `  [${p.number}] ${p.name} (${p.type}) id=${p.id}`).join('\n')
      : '  (none)';

    let formations = '(none)';
    try {
      const files = readdirSync(join(process.cwd(), 'formations')).filter((f: string) => f.endsWith('.yaml'));
      formations = files.map((f: string) => f.replace('.yaml', '')).join(', ');
    } catch {}

    return `You are Sworm, an AI assistant controlling a developer's desktop workspace.
You manage terminal panes (Claude Code agents and shells), launch applications, and orchestrate windows.

CAPABILITIES:
- Create Claude Code agent panes (they start with "claude" command — an AI coding assistant in the terminal)
- Create shell panes for running commands
- Write text/prompts to any pane's terminal (use this to prompt Claude Code agents)
- Kill/close panes
- Launch apps (Chrome, VS Code, terminal, etc.)

RULES:
- When asked to "open agents", create Claude Code panes (cmd: "claude")
- When asked to "open shells" or "open terminals", create shell panes (cmd: "")
- If the user asks for "windows" without a clear target app, ask a brief clarification question
- For bare requests like "open 4 new windows", do not call any tool until the user clarifies the target app
- "Claude windows" means Claude Code app windows, not internal panes
- When the user asks to open Claude windows, use open_claude_windows
- When the user refers to Claude windows by number, use the numbered Claude window list from list_claude_windows before acting
- When the user asks to move, maximize, or position a Claude window by number, use move_claude_window
- When the user asks to focus, open, or bring a Claude window to the front by number, use focus_claude_window
- If the user asks for a good setup or formation for multiple app windows, arrange them automatically using safe visible placements
- Keep windows fully visible when possible, spread to multiple monitors before compromising, and ask a short question if no clean visible layout fits
- When asked to prompt/instruct agents, use write_to_pane to send the prompt text
- After creating panes, wait 1-2 seconds before writing to them (the terminal needs time to initialize)
- SPATIAL ARRANGEMENT (ALWAYS DO THIS BY DEFAULT):
  - When opening multiple apps, ALWAYS use launch_and_arrange — it launches, waits, finds windows, and tiles them automatically
  - Do NOT use launch_app multiple times and then try to arrange manually — use launch_and_arrange instead
  - The user does NOT need to say "side by side" — auto-arrangement is the default
  - For a single app, use launch_app (it will just open normally)
  - EXCEPTION: if the user says "in the background" or "don't arrange", use launch_app instead
- Be concise in your final response — just confirm what you did
- If the user's request is unclear or conversational (just chatting), respond conversationally without using tools

CURRENT STATE:
Active panes:
${paneList}

Available formations: ${formations}
Working directory: ${process.cwd()}`;
  }
}

function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    const s = typeof v === 'string' ? (v.length > 40 ? v.slice(0, 40) + '...' : v) : String(v);
    parts.push(`${k}=${s}`);
  }
  return parts.join(', ') || '(none)';
}
