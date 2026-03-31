import type { Command } from 'commander';
import { listFormations, loadFormation } from '../../config/loader.js';
import { printFormationList, printError } from '../output.js';

export function listCommand(program: Command): void {
  program
    .command('list')
    .description('List available formations')
    .action(() => {
      try {
        const formations = listFormations();
        const details = new Map<string, { description?: string; wormCount: number }>();
        for (const name of formations) {
          try {
            const config = loadFormation(name);
            details.set(name, {
              description: config.description,
              wormCount: config.worms.length,
            });
          } catch {
            // If a formation fails to parse, still list it without details
          }
        }
        printFormationList(formations, details);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        printError(msg);
        process.exit(1);
      }
    });
}
