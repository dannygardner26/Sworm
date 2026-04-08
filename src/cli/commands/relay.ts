import type { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { RelayServer } from '../../relay/server.js';
import { printSuccess, printError, printInfo } from '../output.js';

const PID_PATH = join(homedir(), '.sworm', 'relay.pid');

function readPid(): number | null {
  if (!existsSync(PID_PATH)) return null;
  const pid = parseInt(readFileSync(PID_PATH, 'utf-8').trim(), 10);
  return isNaN(pid) ? null : pid;
}

function writePid(pid: number): void {
  mkdirSync(join(homedir(), '.sworm'), { recursive: true });
  writeFileSync(PID_PATH, String(pid), 'utf-8');
}

function removePid(): void {
  if (existsSync(PID_PATH)) unlinkSync(PID_PATH);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function relayCommand(program: Command): void {
  const relay = program
    .command('relay')
    .description('Start a Sworm relay server for team communication');

  // ── relay start (default) ───────────────────────────────────────────────
  relay
    .command('start', { isDefault: true })
    .description('Start the relay server')
    .option('-p, --port <port>', 'Port to listen on', '7891')
    .option('--host <host>', 'Host to bind to', '0.0.0.0')
    .option('--daemon', 'Run in the background and write PID to ~/.sworm/relay.pid')
    .action(async (opts: { port: string; host: string; daemon?: boolean }) => {
      const port = parseInt(opts.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        printError('Invalid port number');
        process.exit(1);
      }

      if (opts.daemon) {
        // Check if already running
        const existing = readPid();
        if (existing && isRunning(existing)) {
          printError(`Relay is already running (PID ${existing}).`);
          printInfo('Stop it with: sworm relay stop');
          process.exit(1);
        }

        // Spawn a detached child running the relay without --daemon
        const args = [
          ...process.argv.slice(1, 2), // the script/bin path
          'relay',
          'start',
          '--port', opts.port,
          '--host', opts.host,
        ];
        const child = spawn(process.execPath, args, {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env },
        });
        child.unref();
        writePid(child.pid!);
        printSuccess(`Relay started in background (PID ${child.pid})`);
        console.log(chalk.dim(`  Port : ${port}`));
        console.log(chalk.dim(`  PID  : ${PID_PATH}`));
        console.log(chalk.dim(`\n  Stop with: sworm relay stop\n`));
        return;
      }

      // Foreground mode
      const server = new RelayServer({
        port,
        host: opts.host,
        logger: (msg) => console.log(chalk.dim(`[${new Date().toLocaleTimeString()}]`) + ' ' + msg),
      });

      await server.listen();

      printSuccess(`Relay running on ${chalk.bold(`ws://${opts.host}:${port}`)}`);
      printInfo('Self-hosting tip: run `sworm relay start --daemon` for background mode.');
      printInfo('For a public relay, point your team\'s relayUrl to wss://relay.sworm.dev');
      console.log(chalk.dim('\n  Ctrl+C to stop\n'));

      const shutdown = async () => {
        console.log('\n' + chalk.dim('Shutting down relay...'));
        await server.close();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });

  // ── relay stop ──────────────────────────────────────────────────────────
  relay
    .command('stop')
    .description('Stop a backgrounded relay daemon')
    .action(() => {
      const pid = readPid();
      if (!pid) {
        printError('No relay PID file found. Is the daemon running?');
        process.exit(1);
      }
      if (!isRunning(pid)) {
        printInfo(`Relay process (PID ${pid}) is not running. Cleaning up PID file.`);
        removePid();
        return;
      }
      try {
        process.kill(pid, 'SIGTERM');
        removePid();
        printSuccess(`Relay stopped (PID ${pid}).`);
      } catch (err) {
        printError(`Failed to stop relay: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // ── relay status ─────────────────────────────────────────────────────────
  relay
    .command('status')
    .description('Check whether the relay daemon is running')
    .action(() => {
      const pid = readPid();
      if (!pid) {
        printInfo('No relay daemon running (no PID file).');
        return;
      }
      if (isRunning(pid)) {
        printSuccess(`Relay is running (PID ${pid}).`);
      } else {
        printInfo(`Relay PID file exists (${pid}) but process is not running. Run \`sworm relay stop\` to clean up.`);
      }
    });
}
