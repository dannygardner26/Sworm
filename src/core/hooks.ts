import { exec, type ExecException } from 'node:child_process';

const HOOK_TIMEOUT_MS = 30_000;

export interface HookContext {
  formation: string;
  [key: string]: string;
}

export interface HookResult {
  command: string;
  stdout: string;
  stderr: string;
}

export class HookError extends Error {
  readonly command: string;
  readonly phase: 'pre' | 'post';

  constructor(command: string, phase: 'pre' | 'post', cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Hook failed [${phase}]: ${command}\n${msg}`);
    this.name = 'HookError';
    this.command = command;
    this.phase = phase;
    this.cause = cause;
  }
}

export async function runHooks(
  commands: string[],
  phase: 'pre' | 'post',
  context: HookContext,
  onCommand?: (command: string) => void,
): Promise<HookResult[]> {
  const results: HookResult[] = [];

  for (const template of commands) {
    const command = interpolate(template, context);
    onCommand?.(command);

    const result = await execCommand(command, context);
    if (result instanceof Error) {
      throw new HookError(command, phase, result);
    }
    results.push(result);
  }

  return results;
}

function execCommand(command: string, context: HookContext): Promise<HookResult | Error> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        timeout: HOOK_TIMEOUT_MS,
        env: { ...process.env, ...contextToEnv(context) },
      },
      (err: ExecException | null, stdout: string, stderr: string) => {
        if (err) {
          resolve(err);
        } else {
          resolve({ command, stdout: stdout.trim(), stderr: stderr.trim() });
        }
      },
    );
  });
}

function interpolate(template: string, context: HookContext): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key) => context[key] ?? '');
}

function contextToEnv(context: HookContext): Record<string, string> {
  return Object.fromEntries(
    Object.entries(context).map(([k, v]) => [`SWORM_${k.toUpperCase()}`, v]),
  );
}
