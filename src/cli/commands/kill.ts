import type { Command } from 'commander';
import ora from 'ora';
import type { Swarm } from '../../core/swarm.js';
import { printSuccess, printError } from '../output.js';

export function killCommand(program: Command, getSwarm: () => Swarm): void {
  program
    .command('kill [target]')
    .description('Kill worms (all, by formation name, or by --id)')
    .option('--id <wormId>', 'Kill a specific worm by ID')
    .action(async (target: string | undefined, opts: { id?: string }) => {
      const swarm = getSwarm();
      const killTarget = opts.id ?? target;

      const label = killTarget ? `Killing ${killTarget}...` : 'Killing all worms...';
      const spinner = ora(label).start();

      try {
        await swarm.kill(killTarget);
        spinner.stop();
        printSuccess(killTarget ? `Killed ${killTarget}.` : 'All worms killed.');
      } catch (err) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError(msg);
        process.exit(1);
      }
    });
}
