import type { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { Swarm } from '../../core/swarm.js';
import type { PlatformAPI } from '../../platform/types.js';
import { loadFormation } from '../../config/loader.js';
import { resolveMonitor, resolvePosition } from '../../core/formation.js';
import { printSuccess, printError } from '../output.js';

export function deployCommand(
  program: Command,
  getSwarm: () => Swarm,
  getPlatform: () => PlatformAPI,
): void {
  program
    .command('deploy <formation>')
    .description('Deploy a named formation')
    .option('--force', 'Kill existing worms before deploying')
    .option('--dry-run', 'Show what would happen without doing it')
    .action(async (formation: string, opts: { force?: boolean; dryRun?: boolean }) => {
      try {
        if (opts.dryRun) {
          await dryRun(formation, getPlatform());
          return;
        }

        const swarm = getSwarm();
        const bus = swarm.getEventBus();

        const spinner = ora(`Deploying formation ${chalk.bold(formation)}...`).start();

        bus.on('worm:spawning', (wormId) => {
          spinner.text = `Spawning ${chalk.cyan(wormId)}...`;
        });

        bus.on('worm:running', (wormId) => {
          spinner.text = `${chalk.cyan(wormId)} window found, positioning...`;
        });

        bus.on('worm:positioned', (wormId) => {
          spinner.text = `${chalk.cyan(wormId)} positioned`;
        });

        try {
          await swarm.deploy(formation, { force: opts.force });
          spinner.stop();
          printSuccess(`Formation ${chalk.bold(formation)} deployed successfully.`);
        } catch (err) {
          spinner.stop();
          const msg = err instanceof Error ? err.message : String(err);
          printError(`Deploy failed: ${msg}`);
          process.exit(1);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        printError(msg);
        process.exit(1);
      }
    });
}

async function dryRun(formation: string, platform: PlatformAPI): Promise<void> {
  const config = loadFormation(formation);
  const monitors = await platform.monitors.getAll();

  const table = new Table({
    head: [
      chalk.white('Worm ID'),
      chalk.white('Type'),
      chalk.white('Monitor'),
      chalk.white('Position (x, y, w, h)'),
    ],
    style: { head: [], border: [] },
  });

  for (const wormConfig of config.worms) {
    const monitor = resolveMonitor(wormConfig.monitor, monitors);
    const rect = resolvePosition(wormConfig.position, monitor, config.grid);

    table.push([
      wormConfig.id,
      wormConfig.type,
      monitor.name,
      `${rect.x}, ${rect.y}, ${rect.width}, ${rect.height}`,
    ]);
  }

  console.log(chalk.bold(`\nDry run for formation: ${formation}\n`));
  console.log(table.toString());
  console.log();
}
