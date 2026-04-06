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
    .command('deploy [formation]')
    .description('Deploy a named formation (omit name to see choices)')
    .option('--force', 'Kill existing worms before deploying')
    .option('--dry-run', 'Show what would happen without doing it')
    .action(async (formation: string | undefined, opts: { force?: boolean; dryRun?: boolean }) => {
      try {
        // If no formation given, list available ones and exit with a hint
        if (!formation) {
          const { listFormations } = await import('../../config/loader.js');
          const formations = listFormations();
          if (formations.length === 0) {
            printError('No formations found. Create a YAML file in formations/');
            process.exit(1);
          }
          console.log(chalk.bold('\nAvailable formations:\n'));
          for (const name of formations) {
            console.log(`  ${chalk.cyan(name)}`);
          }
          console.log(chalk.dim(`\nUsage: sworm deploy <name>\n`));
          return;
        }

        if (opts.dryRun) {
          await dryRun(formation, getPlatform(), getSwarm);
          return;
        }

        const swarm = getSwarm();
        const bus = swarm.getEventBus();

        const spinner = ora(`Deploying formation ${chalk.bold(formation)}...`).start();

        bus.on('hook:running', (phase, command) => {
          spinner.text = `Running ${phase} hook: ${chalk.dim(command)}`;
        });

        bus.on('hook:failed', (phase, command, error) => {
          spinner.warn(`${phase} hook failed: ${chalk.dim(command)}\n  ${chalk.red(error.message)}`);
        });

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

async function dryRun(
  formation: string,
  platform: PlatformAPI,
  getSwarm: () => Swarm,
): Promise<void> {
  const config = loadFormation(formation);
  const monitors = await platform.monitors.getAll();

  // Run pre-flight validation and surface issues before showing the layout table
  const swarm = getSwarm();
  const validation = await swarm.validate(config);

  console.log(chalk.bold(`\nDry run for formation: ${formation}\n`));

  if (!validation.valid) {
    console.log(chalk.red.bold('Pre-flight issues:'));
    for (const issue of validation.issues) {
      const prefix = issue.wormId ? chalk.yellow(`[${issue.wormId}]`) + ' ' : '';
      console.log(`  ${chalk.red('✗')} ${prefix}${issue.message}`);
    }
    console.log();
  }

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
    try {
      const monitorRef = config.monitors?.[wormConfig.monitor] ?? wormConfig.monitor;
      const monitor = resolveMonitor(monitorRef, monitors);
      const rect = resolvePosition(wormConfig.position, monitor, config.grid);
      table.push([
        wormConfig.id,
        wormConfig.type,
        monitor.name,
        `${rect.x}, ${rect.y}, ${rect.width}, ${rect.height}`,
      ]);
    } catch {
      table.push([
        wormConfig.id,
        wormConfig.type,
        chalk.red(wormConfig.monitor),
        chalk.red('(unresolvable)'),
      ]);
    }
  }

  console.log(table.toString());
  console.log();

  if (!validation.valid) {
    process.exit(1);
  }
}
