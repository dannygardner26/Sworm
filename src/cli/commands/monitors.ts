import type { Command } from 'commander';
import ora from 'ora';
import type { PlatformAPI } from '../../platform/types.js';
import { printMonitors, printError } from '../output.js';

export function monitorsCommand(program: Command, getPlatform: () => PlatformAPI): void {
  program
    .command('monitors')
    .description('List connected monitors')
    .action(async () => {
      const spinner = ora('Detecting monitors...').start();

      try {
        const monitors = await getPlatform().monitors.getAll();
        spinner.stop();
        printMonitors(monitors);
      } catch (err) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError(msg);
        process.exit(1);
      }
    });
}
