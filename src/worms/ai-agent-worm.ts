import { execSync } from 'node:child_process';
import path from 'node:path';
import { Worm } from '../core/worm.js';
import type { WormConfig } from '../config/schema.js';
import type { PlatformAPI } from '../platform/types.js';

interface AIAgentWormParams {
  provider: string; // Name in providers.yaml
  model?: string; // Override provider's default model
  repo: string; // Git repo path or "."
  branch?: string; // Create worktree for this branch
  worktreePath?: string; // Custom worktree location
  prompt: string; // Task for the agent
  systemPrompt?: string; // Override system prompt
  shell?: 'wt' | 'cmd' | 'powershell';
}

export class AIAgentWorm extends Worm {
  readonly type = 'ai-agent';
  private pid: number | null = null;
  private cwd: string = '';

  constructor(id: string, config: WormConfig, platform: PlatformAPI) {
    super(id, config, platform);
  }

  async spawn(): Promise<void> {
    this.status = 'spawning';

    const params = this.config.params as unknown as AIAgentWormParams;
    if (!params.provider) throw new Error(`AIAgentWorm ${this.id}: "provider" param is required`);
    if (!params.prompt) throw new Error(`AIAgentWorm ${this.id}: "prompt" param is required`);

    const repoPath = params.repo === '.' ? process.cwd() : path.resolve(params.repo);
    let workingDir = repoPath;

    // Create git worktree if branch specified
    if (params.branch) {
      const worktreePath =
        params.worktreePath ?? path.join(repoPath, '..', `worktree-${this.id}-${params.branch}`);
      try {
        execSync(`git -C "${repoPath}" worktree add "${worktreePath}" ${params.branch}`, {
          stdio: 'pipe',
        });
      } catch {
        // Branch might already exist as worktree, try checking it out
        execSync(`git -C "${repoPath}" worktree add "${worktreePath}" -b ${params.branch}`, {
          stdio: 'pipe',
        });
      }
      workingDir = worktreePath;
    }

    this.cwd = workingDir;
    const shell = params.shell ?? 'wt';

    // Build the agent runner command
    const swormRoot = path.resolve(
      new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
      '..',
      '..',
    );
    const runnerScript = path.join(swormRoot, 'src', 'agent', 'runner.ts');

    const agentArgs = [
      'tsx',
      runnerScript,
      '--provider',
      params.provider,
      '--cwd',
      workingDir,
      '--prompt',
      params.prompt,
    ];
    if (params.model) agentArgs.push('--model', params.model);
    if (params.systemPrompt) agentArgs.push('--system', params.systemPrompt);

    const agentCmd = `npx ${agentArgs.join(' ')}`;

    let command: string;
    let args: string[];

    switch (shell) {
      case 'wt':
        command = 'wt.exe';
        args = [
          '-w',
          'new',
          '-d',
          workingDir,
          '--title',
          `[Agent] ${this.id}`,
          '--',
          'cmd',
          '/c',
          agentCmd,
        ];
        break;
      case 'cmd':
        command = 'cmd.exe';
        args = ['/c', `start cmd /k "cd /d ${workingDir} && ${agentCmd}"`];
        break;
      case 'powershell':
        command = 'powershell.exe';
        args = [
          '-Command',
          `Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd ${workingDir}; ${agentCmd}'`,
        ];
        break;
    }

    const spawned = await this.platform.processes.spawn(command!, args!, { detached: true });
    this.pid = spawned.pid;
    this.status = 'running';
  }

  async findWindow(): Promise<number> {
    const dirName = path.basename(this.cwd);
    const pattern = new RegExp(`(${dirName}|Agent.*${this.id}|agent)`, 'i');
    const hwnds = await this.platform.windows.findByTitle(pattern);

    if (hwnds.length === 0) {
      throw new Error(`AIAgentWorm ${this.id}: no windows found matching "${pattern.source}"`);
    }

    return hwnds[0];
  }
}
