/**
 * Process management for Windows.
 * Uses child_process for spawning and tasklist for discovery.
 */
import { spawn as cpSpawn, execSync } from 'node:child_process';
import type { SpawnOpts, SpawnedProcess, ProcessInfo } from '../types.js';

export async function spawn(
  command: string,
  args: string[],
  opts?: SpawnOpts,
): Promise<SpawnedProcess> {
  // Windows Terminal: force a new window with `-w new` (only if not already specified)
  const isWt = command === 'wt' || command === 'wt.exe';
  const hasWindowFlag = args.includes('-w') || args.includes('--window');
  const finalArgs = (isWt && !hasWindowFlag) ? ['-w', 'new', ...args] : args;

  const child = cpSpawn(command, finalArgs, {
    cwd: opts?.cwd,
    env: opts?.env ? { ...process.env, ...opts.env } : undefined,
    shell: opts?.shell,
    detached: opts?.detached ?? false,
    stdio: 'ignore',
  });

  // Prevent the parent from waiting on a detached child
  if (opts?.detached) {
    child.unref();
  }

  const pid = child.pid;
  if (pid === undefined) {
    throw new Error(`Failed to spawn process: ${command}`);
  }

  return {
    pid,
    kill() {
      try {
        child.kill();
      } catch {
        // Process may have already exited — ignore.
      }
    },
  };
}

export async function findByName(name: string): Promise<ProcessInfo[]> {
  try {
    const output = execSync('tasklist /fo csv /nh', {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const results: ProcessInfo[] = [];
    const lowerName = name.toLowerCase();

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // CSV format: "name.exe","PID","Session Name","Session#","Mem Usage"
      const match = trimmed.match(/^"([^"]+)","(\d+)"/);
      if (!match) continue;

      const [, procName, pidStr] = match;
      if (procName.toLowerCase().includes(lowerName)) {
        results.push({
          pid: parseInt(pidStr, 10),
          name: procName,
        });
      }
    }

    return results;
  } catch {
    return [];
  }
}
