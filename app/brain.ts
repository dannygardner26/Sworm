/**
 * Sworm Brain — LLM-powered command interpretation and execution
 * Uses Gemini via Google Cloud Vertex AI for natural language understanding.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { request } from 'node:https';
import { TOOL_DEFINITIONS, executeTool, type BrainContext, type ToolDefinition } from './brain-tools';

const MODEL = 'gemini-3.1-flash-lite-preview';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_ITERATIONS = 10;
const TIMEOUT_MS = 30000;

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown>; thoughtSignature?: string }>;
  /** Raw model parts — preserved so thoughtSignatures are echoed back correctly */
  rawParts?: any[];
}

export class SwormBrain {
  private ctx: BrainContext;
  private history: Message[] = [];
  private onStatus: (type: string, detail?: string) => void;
  private apiKey: string;

  constructor(ctx: BrainContext, onStatus: (type: string, detail?: string) => void) {
    this.ctx = ctx;
    this.onStatus = onStatus;
    // Load API key from ~/.sworm/.gemini-key or env
    const keyPath = join(homedir(), '.sworm', '.gemini-key');
    try {
      this.apiKey = process.env.GEMINI_API_KEY || readFileSync(keyPath, 'utf-8').trim();
    } catch {
      throw new Error('No Gemini API key. Set GEMINI_API_KEY env or create ~/.sworm/.gemini-key');
    }
  }

  async process(userText: string): Promise<string> {
    this.onStatus('thinking');
    this.ctx.log(`[Brain] Processing: "${userText}"`);

    const systemPrompt = await this.buildSystemPrompt();
    this.history.push({ role: 'user', content: userText });

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
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this.callGemini(systemPrompt);

      if (response.toolCalls?.length) {
        this.history.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls,
          rawParts: response.rawParts,
        });

        for (const tc of response.toolCalls) {
          this.onStatus('tool-call', `${tc.name}: ${summarizeArgs(tc.arguments)}`);
          const result = await executeTool(tc.name, tc.arguments, this.ctx);
          this.history.push({
            role: 'tool',
            content: result.error ? `Error: ${result.error}` : result.output,
            toolCallId: tc.id,
          });
        }
        continue;
      }

      const text = response.content || 'Done';
      this.history.push({ role: 'assistant', content: text });
      this.onStatus('result', text);
      return text;
    }

    return 'Reached maximum iterations';
  }

  private async callGemini(systemPrompt: string): Promise<{
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown>; thoughtSignature?: string }>;
    rawParts?: any[];
  }> {
    // Build Gemini contents from history — preserve raw parts for thoughtSignature
    const contents: any[] = [];
    for (const m of this.history) {
      if (m.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: m.content }] });
      } else if (m.role === 'assistant' && m.rawParts) {
        // Use raw parts to preserve thoughtSignature
        contents.push({ role: 'model', parts: m.rawParts });
      } else if (m.role === 'assistant' && m.toolCalls?.length) {
        contents.push({
          role: 'model',
          parts: m.toolCalls.map(tc => ({
            functionCall: { name: tc.name, args: tc.arguments },
            ...(tc.thoughtSignature ? { thoughtSignature: tc.thoughtSignature } : {}),
          })),
        });
      } else if (m.role === 'assistant') {
        contents.push({ role: 'model', parts: [{ text: m.content }] });
      } else if (m.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: m.toolCallId || 'unknown',
              response: { result: m.content },
            },
          }],
        });
      }
    }

    // Build tool declarations
    const tools = [{
      functionDeclarations: TOOL_DEFINITIONS.map((t: ToolDefinition) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    }];

    const body = JSON.stringify({
      contents,
      tools,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    });

    const url = `${API_BASE}/models/${MODEL}:generateContent?key=${this.apiKey}`;

    const responseBody = await this.httpPost(url, body);
    const data = JSON.parse(responseBody);

    let content = '';
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown>; thoughtSignature?: string }> = [];

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.text) content += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: part.functionCall.id || part.functionCall.name,
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
          thoughtSignature: part.thoughtSignature,
        });
      }
    }

    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined, rawParts: parts };
  }

  private httpPost(url: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const req = request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Gemini API ${res.statusCode}: ${data.slice(0, 200)}`));
          } else {
            resolve(data);
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
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
- When asked to "open agents" or "open windows", create Claude Code panes (cmd: "claude")
- When asked to "open shells" or "open terminals", create shell panes (cmd: "")
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
