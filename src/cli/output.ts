import chalk from 'chalk';
import Table from 'cli-table3';
import type { WormStatusInfo } from '../core/worm.js';
import type { MonitorInfo } from '../platform/types.js';

export function printFormationList(formations: string[]): void {
  if (formations.length === 0) {
    printInfo('No formations found.');
    return;
  }

  console.log(chalk.bold('\nAvailable formations:\n'));
  for (let i = 0; i < formations.length; i++) {
    console.log(`  ${chalk.cyan(`${i + 1}.`)} ${formations[i]}`);
  }
  console.log();
}

export function printStatus(worms: WormStatusInfo[]): void {
  if (worms.length === 0) {
    printInfo('No active worms.');
    return;
  }

  const table = new Table({
    head: [
      chalk.white('#'),
      chalk.white('ID'),
      chalk.white('Type'),
      chalk.white('Status'),
      chalk.white('HWND'),
    ],
    style: { head: [], border: [] },
  });

  for (const w of worms) {
    const statusColor =
      w.status === 'running' || w.status === 'positioned'
        ? chalk.green
        : w.status === 'dead'
          ? chalk.red
          : chalk.yellow;

    table.push([
      w.number !== undefined ? String(w.number) : chalk.dim('-'),
      w.id,
      w.type,
      statusColor(w.status),
      w.hwnd !== null ? String(w.hwnd) : chalk.dim('n/a'),
    ]);
  }

  console.log(table.toString());
}

export function printMonitors(monitors: MonitorInfo[]): void {
  if (monitors.length === 0) {
    printInfo('No monitors detected.');
    return;
  }

  const table = new Table({
    head: [
      chalk.white('Name'),
      chalk.white('Resolution'),
      chalk.white('Work Area'),
      chalk.white('Scale'),
      chalk.white('Primary'),
    ],
    style: { head: [], border: [] },
  });

  for (const m of monitors) {
    table.push([
      m.name,
      `${m.bounds.width}x${m.bounds.height}`,
      `${m.workArea.x},${m.workArea.y} ${m.workArea.width}x${m.workArea.height}`,
      `${m.scaleFactor}x`,
      m.primary ? chalk.green('Yes') : chalk.dim('No'),
    ]);
  }

  console.log(table.toString());
}

export function printSuccess(msg: string): void {
  console.log(chalk.green('\u2714') + ' ' + msg);
}

export function printError(msg: string): void {
  console.log(chalk.red('\u2718') + ' ' + msg);
}

export function printInfo(msg: string): void {
  console.log(chalk.blue('\u2139') + ' ' + msg);
}
