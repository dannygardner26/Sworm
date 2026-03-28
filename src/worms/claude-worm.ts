import { execSync } from 'node:child_process';
import path from 'node:path';
import { Worm } from '../core/worm.js';
import type { WormConfig } from '../config/schema.js';
import type { PlatformAPI } from '../platform/types.js';

interface ClaudeWormParams {
  repo: string;
  branch?: string;
  worktreePath?: string;
  initialPrompt?: string;
  shell?: 'wt' | 'cmd' | 'powershell';
}

export class ClaudeWorm extends Worm {
  readonly type = 'claude';
  private pid: number | null = null;
  private cwd: string = '';
  private windowsBefore: Set<number> = new Set();

  constructor(id: string, config: WormConfig, platform: PlatformAPI) {
    super(id, config, platform);
  }

  async spawn(): Promise<void> {
    this.status = 'spawning';

    // Snapshot windows before spawn
    const before = await this.platform.windows.findByTitle(/./);
    this.windowsBefore = new Set(before);

    const params = this.config.params as unknown as ClaudeWormParams;
    if (!params.repo) {
      throw new Error(`ClaudeWorm ${this.id}: "repo" param is required`);
    }

    const repoPath = params.repo === '.' ? process.cwd() : path.resolve(params.repo);
    let workingDir = repoPath;

    // Create git worktree if branch is specified
    if (params.branch) {
      const worktreePath =
        params.worktreePath ?? path.join(repoPath, '..', `worktree-${this.id}-${params.branch}`);
      execSync(`git -C "${repoPath}" worktree add "${worktreePath}" ${params.branch}`, {
        stdio: 'pipe',
      });
      workingDir = worktreePath;
    }

    this.cwd = workingDir;

    const shell = params.shell ?? 'wt';
    const claudeCmd = params.initialPrompt ? `claude "${params.initialPrompt}"` : 'claude';

    let command: string;
    let args: string[];

    switch (shell) {
      case 'wt':
        command = 'wt.exe';
        args = ['-w', 'new', '-d', workingDir, '--', ...claudeCmd.split(' ')];
        break;
      case 'cmd':
        command = 'cmd.exe';
        args = ['/c', `start cmd /k "cd /d ${workingDir} && ${claudeCmd}"`];
        break;
      case 'powershell':
        command = 'powershell.exe';
        args = [
          '-Command',
          `Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd ${workingDir}; ${claudeCmd}'`,
        ];
        break;
    }

    const spawned = await this.platform.processes.spawn(command, args, { detached: true });
    this.pid = spawned.pid;
    this.status = 'running';
  }

  async findWindow(): Promise<number> {
    // Find new windows that appeared after spawn
    const current = await this.platform.windows.findByTitle(/./);
    const newWindows = current.filter(h => !this.windowsBefore.has(h));

    if (newWindows.length > 0) {
      return newWindows[0];
    }

    // Fallback: try title matching
    const dirName = path.basename(this.cwd);
    const pattern = new RegExp(`(${dirName}|claude)`, 'i');
    const hwnds = await this.platform.windows.findByTitle(pattern);
    if (hwnds.length > 0) return hwnds[0];

    throw new Error(`ClaudeWorm ${this.id}: no new windows found`);
  }
}
