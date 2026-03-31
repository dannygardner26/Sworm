import type { Command } from 'commander';
import type { Swarm } from '../../core/swarm.js';
import { printStatus, printError } from '../output.js';

export function statusCommand(program: Command, getSwarm: () => Swarm): void {
  program
    .command('status')
    .description('Show status of active worms')
    .action(() => {
      try {
        const worms = getSwarm().status();
        printStatus(worms);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        printError(msg);
        process.exit(1);
      }
    });
}
