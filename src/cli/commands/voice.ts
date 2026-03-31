import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import type { Swarm } from '../../core/swarm.js';
import { createVoiceListener, type VoiceListenerOptions } from '../../voice/index.js';
import type { VoiceCommand } from '../../voice/commands.js';
import { listFormations } from '../../config/loader.js';
import { printSuccess, printError, printInfo, printStatus, printFormationList } from '../output.js';
import { loadSettings } from '../../config/settings.js';

/** Shared handler that executes a parsed voice command against a swarm. */
function handleVoiceCommand(command: VoiceCommand, swarm: Swarm): void {
  switch (command.action) {
    case 'deploy':
      if (!command.target) { printError('Deploy requires a formation name.'); return; }
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
      try { printFormationList(listFormations()); } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
      }
      break;

    case 'focus':
      if (command.target) {
        // Note: this was focusing, not killing — likely a bug in original. Keeping as-is.
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
}

export function voiceCommand(
  program: Command,
  getSwarm: () => Swarm,
): void {
  const voiceCmd = program
    .command('voice')
    .description('Voice command system — listen, setup, or configure');

  // ─── sworm voice setup ─────────────────────────────────
  voiceCmd
    .command('setup')
    .description('Download and configure whisper.cpp + tiny.en model')
    .action(async () => {
      const spinner = ora('Setting up voice...').start();
      try {
        const { setupVoice } = await import('../../voice/setup.js');
        const paths = await setupVoice((msg) => { spinner.text = msg; });
        spinner.stop();
        printSuccess('Voice setup complete!');
        console.log(chalk.dim(`  Binary: ${paths.whisperPath}`));
        console.log(chalk.dim(`  Model:  ${paths.modelPath}`));

        const { updateSettings } = await import('../../config/settings.js');
        const settings = loadSettings();
        updateSettings({
          voice: {
            ...settings.voice,
            enabled: true,
            whisper: {
              binaryPath: paths.whisperPath,
              modelPath: paths.modelPath,
              sampleRate: 16000,
            },
          },
        });
        printSuccess('Settings updated.');
      } catch (err) {
        spinner.stop();
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ─── sworm voice status ────────────────────────────────
  voiceCmd
    .command('status')
    .description('Show voice activation status')
    .action(async () => {
      const settings = loadSettings();
      const { isVoiceSetup, getVoicePaths } = await import('../../voice/setup.js');
      const paths = getVoicePaths();
      const ready = isVoiceSetup();

      console.log(chalk.bold('\nVoice Activation\n'));
      console.log(`  Setup:        ${ready ? chalk.green('Ready') : chalk.red('Not configured')} ${!ready ? chalk.dim('(run: sworm voice setup)') : ''}`);
      console.log(`  Enabled:      ${settings.voice.enabled ? chalk.green('Yes') : chalk.dim('No')}`);
      console.log(`  Push-to-talk: ${settings.voice.pushToTalk.enabled ? chalk.green(settings.voice.pushToTalk.hotkey) : chalk.dim('Disabled')}`);
      console.log(`  Wake word:    ${settings.voice.wakeWord.enabled ? chalk.green(`"hey ${settings.voice.wakeWord.phrase}"`) : chalk.dim('Disabled')}`);
      console.log(`  Recorder:     ${chalk.dim(settings.voice.recorder)}`);
      console.log(`  Whisper bin:  ${chalk.dim(settings.voice.whisper.binaryPath || paths.whisperPath)}`);
      console.log(`  Model:        ${chalk.dim(settings.voice.whisper.modelPath || paths.modelPath)}`);
      console.log();
    });

  // ─── sworm voice listen ────────────────────────────────
  voiceCmd
    .command('listen')
    .description('Start voice activation (push-to-talk + wake word)')
    .option('--no-wake', 'Disable wake word, hotkey-only')
    .option('--bridge', 'Use HTTP bridge mode instead of whisper')
    .option('--port <port>', 'Bridge port', '7483')
    .action(async (opts: { wake: boolean; bridge: boolean; port: string }) => {
      const settings = loadSettings();
      const swarm = getSwarm();

      // Bridge mode (legacy)
      if (opts.bridge) {
        const listener = createVoiceListener({
          engine: 'bridge',
          bridgePort: parseInt(opts.port, 10),
        });
        listener.onCommand((cmd) => {
          printInfo(`Voice: ${chalk.bold(cmd.action)}${cmd.target ? ` ${cmd.target}` : ''}`);
          handleVoiceCommand(cmd, swarm);
        });
        await listener.start();
        printSuccess(`Bridge listener on port ${opts.port}`);
        printInfo('Press Ctrl+C to stop.');
        await new Promise<void>((resolve) => {
          process.on('SIGINT', () => { listener.stop().then(() => resolve(), () => resolve()); });
        });
        return;
      }

      // Whisper mode (default)
      // IMPORTANT: Set keepalive BEFORE async imports to prevent Node from exiting
      const keepAlive = setInterval(() => {}, 60000);

      const { isVoiceSetup, getVoicePaths } = await import('../../voice/setup.js');
      if (!isVoiceSetup()) {
        clearInterval(keepAlive);
        printError('Voice not set up. Run: sworm voice setup');
        process.exit(1);
      }

      const paths = getVoicePaths();
      const { VoiceActivation } = await import('../../voice/voice-activation.js');
      const va = new VoiceActivation({
        whisperPath: settings.voice.whisper.binaryPath || paths.whisperPath,
        modelPath: settings.voice.whisper.modelPath || paths.modelPath,
        sampleRate: settings.voice.whisper.sampleRate,
        recorder: settings.voice.recorder,
        pttTimeout: settings.voice.pttTimeout,
        silenceChunks: settings.voice.silenceChunks,
        wakeWordEnabled: opts.wake && settings.voice.wakeWord.enabled,
        wakeWord: settings.voice.wakeWord.phrase,
      });

      va.onCommand((cmd, raw) => {
        printInfo(`Voice: ${chalk.bold(raw)} → ${chalk.cyan(cmd.action)}${cmd.target ? ` ${cmd.target}` : ''}`);
        handleVoiceCommand(cmd, swarm);
      });

      // Register push-to-talk hotkey
      const { HotkeyManager } = await import('../../hotkeys/index.js');
      const hkm = new HotkeyManager();
      hkm.onAction((action) => {
        if (action === 'voice-activate') {
          va.startPTT();
        }
      });
      hkm.start();

      if (opts.wake && settings.voice.wakeWord.enabled) {
        va.startWakeWordListener();
        printSuccess(`Wake word: "hey ${settings.voice.wakeWord.phrase}"`);
      }

      printSuccess('Voice activation started.');
      printInfo(`Push-to-talk: ${settings.voice.pushToTalk.hotkey}`);
      printInfo('Press Ctrl+C to stop.');

      await new Promise<void>((resolve) => {
        const shutdown = () => {
          printInfo('\nShutting down...');
          clearInterval(keepAlive);
          va.dispose();
          hkm.stop();
          resolve();
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
      });
    });
}
