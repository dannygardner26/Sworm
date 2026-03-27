import type { Command } from 'commander';
import chalk from 'chalk';
import type { Swarm } from '../../core/swarm.js';
import { createVoiceListener, type VoiceListenerOptions } from '../../voice/index.js';
import { listFormations } from '../../config/loader.js';
import { printSuccess, printError, printInfo, printStatus, printFormationList } from '../output.js';

export function voiceCommand(
  program: Command,
  getSwarm: () => Swarm,
): void {
  program
    .command('voice')
    .description('Start voice command listener')
    .option('--engine <engine>', 'Speech engine: vosk, windows, bridge', 'bridge')
    .option('--port <port>', 'Dictation bridge port', '7483')
    .option('--wake-word <word>', 'Wake word', 'sworm')
    .action(async (opts: { engine: string; port: string; wakeWord: string }) => {
      const listenerOpts: VoiceListenerOptions = {
        engine: opts.engine as VoiceListenerOptions['engine'],
        wakeWord: opts.wakeWord,
        bridgePort: parseInt(opts.port, 10),
      };

      const listener = createVoiceListener(listenerOpts);
      const swarm = getSwarm();

      listener.onCommand((command) => {
        printInfo(`Voice command: ${chalk.bold(command.action)}${command.target ? ` ${command.target}` : ''}`);

        switch (command.action) {
          case 'deploy':
            if (!command.target) {
              printError('Deploy requires a formation name.');
              return;
            }
            swarm.deploy(command.target).then(
              () => printSuccess(`Deployed ${command.target}.`),
              (err) => printError(`Deploy failed: ${err instanceof Error ? err.message : String(err)}`),
            );
            break;

          case 'kill':
            swarm.kill(command.target).then(
              () => printSuccess(`Killed ${command.target ?? 'target'}.`),
              (err) => printError(`Kill failed: ${err instanceof Error ? err.message : String(err)}`),
            );
            break;

          case 'kill-all':
            swarm.kill().then(
              () => printSuccess('All worms killed.'),
              (err) => printError(`Kill failed: ${err instanceof Error ? err.message : String(err)}`),
            );
            break;

          case 'status':
            printStatus(swarm.status());
            break;

          case 'list':
            try {
              printFormationList(listFormations());
            } catch (err) {
              printError(err instanceof Error ? err.message : String(err));
            }
            break;

          case 'focus':
            if (command.target) {
              swarm.kill(command.target).catch(() => {});
            }
            break;

          case 'focus-number': {
            const num = parseInt(command.target ?? '0', 10);
            if (num > 0) {
              swarm.focusByNumber(num).then(
                () => printSuccess(`Focused agent #${num}`),
                (err) => printError(`Focus failed: ${err instanceof Error ? err.message : String(err)}`),
              );
            }
            break;
          }

          case 'expand':
          case 'fullscreen': {
            const n = parseInt(command.target ?? '0', 10);
            const wormId = n > 0 ? swarm.getByNumber(n) : command.target;
            if (wormId) {
              swarm.fullscreenWorm(wormId).then(
                () => printSuccess(`Fullscreen: ${wormId}`),
                (err) => printError(`Expand failed: ${err instanceof Error ? err.message : String(err)}`),
              );
            }
            break;
          }

          case 'toggle-visibility':
            swarm.toggleVisibility().then(
              () => printSuccess('Toggled visibility'),
              (err) => printError(`Toggle failed: ${err instanceof Error ? err.message : String(err)}`),
            );
            break;

          case 'minimize-all':
            swarm.sendAllToBack().then(
              () => printSuccess('All worms sent to back'),
              (err) => printError(`Failed: ${err instanceof Error ? err.message : String(err)}`),
            );
            break;
        }
      });

      try {
        await listener.start();
        printSuccess(`Voice listener started (engine: ${opts.engine}, wake word: "${opts.wakeWord}")`);
        printInfo('Listening for commands. Press Ctrl+C to stop.');

        // Keep the process alive
        await new Promise<void>((resolve) => {
          process.on('SIGINT', () => {
            printInfo('\nStopping voice listener...');
            listener.stop().then(
              () => {
                printSuccess('Voice listener stopped.');
                resolve();
              },
              () => resolve(),
            );
          });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        printError(`Failed to start voice listener: ${msg}`);
        process.exit(1);
      }
    });
}
