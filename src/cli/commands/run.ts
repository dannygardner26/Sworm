import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import type { Swarm } from '../../core/swarm.js';
import type { FormationConfig, WormConfig } from '../../config/schema.js';
import { printSuccess, printError } from '../output.js';

/**
 * Quick-launch command — spawn a single worm without writing YAML.
 *
 *   sworm run claude              → Claude Code, full screen
 *   sworm run claude -z left-half → Claude Code, left half
 *   sworm run shell               → plain terminal
 *   sworm run code .              → VS Code on current dir
 *   sworm run chrome http://…     → browser
 *   sworm run notepad.exe         → any executable
 */
export function runCommand(
  program: Command,
  getSwarm: () => Swarm,
): void {
  program
    .command('run <what> [extra...]')
    .description('Quick-launch a single worm without a formation file')
    .option('-m, --monitor <ref>', 'Target monitor', 'primary')
    .option('-z, --zone <zone>', 'Position zone', 'full')
    .action(async (what: string, extra: string[], opts: { monitor: string; zone: string }) => {
      const spinner = ora(`Launching ${chalk.bold(what)}...`).start();

      try {
        const swarm = getSwarm();
        const config = buildConfig(what, extra, opts);
        await swarm.deployConfig(config);
        spinner.stop();
        printSuccess(`${what} launched.`);
      } catch (err) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError(`Launch failed: ${msg}`);
        process.exit(1);
      }
    });
}

function buildConfig(
  what: string,
  extra: string[],
  opts: { monitor: string; zone: string },
): FormationConfig {
  const position = { zone: opts.zone } as any;
  const monitor = opts.monitor;

  let worm: WormConfig;

  switch (what) {
    case 'claude':
      worm = {
        id: 'claude-quick',
        type: 'claude',
        monitor,
        position,
        params: { repo: extra[0] || '.', shell: 'wt' },
      };
      break;

    case 'shell':
      worm = {
        id: 'shell-quick',
        type: 'generic',
        monitor,
        position,
        params: { executable: 'wt.exe', args: [] },
      };
      break;

    case 'code':
      worm = {
        id: 'code-quick',
        type: 'ide',
        monitor,
        position,
        params: { folder: extra[0] || '.' },
      };
      break;

    default:
      if (what.startsWith('http://') || what.startsWith('https://')) {
        worm = {
          id: 'browser-quick',
          type: 'app',
          monitor,
          position,
          params: { app: 'chrome', url: what },
        };
      } else {
        worm = {
          id: 'app-quick',
          type: 'generic',
          monitor,
          position,
          params: { executable: what, args: extra },
        };
      }
      break;
  }

  return {
    name: `run-${what}`,
    description: `Quick launch — ${what}`,
    worms: [worm],
  };
}
