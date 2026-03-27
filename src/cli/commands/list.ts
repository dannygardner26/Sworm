import type { Command } from 'commander';
import { listFormations } from '../../config/loader.js';
import { printFormationList, printError } from '../output.js';

export function listCommand(program: Command): void {
  program
    .command('list')
    .description('List available formations')
    .action(() => {
      try {
        const formations = listFormations();
        printFormationList(formations);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        printError(msg);
        process.exit(1);
      }
    });
}
