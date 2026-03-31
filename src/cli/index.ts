#!/usr/bin/env node
import { Command } from 'commander';
import { createPlatform } from '../platform/index.js';
import { WormTypeRegistry } from '../core/registry.js';
import { Swarm } from '../core/swarm.js';

import { GenericWorm } from '../worms/generic-worm.js';
import { ClaudeWorm } from '../worms/claude-worm.js';
import { IDEWorm } from '../worms/ide-worm.js';
import { AppWorm } from '../worms/app-worm.js';
import { AIAgentWorm } from '../worms/ai-agent-worm.js';
import { HotkeyManager } from '../hotkeys/index.js';

import { deployCommand } from './commands/deploy.js';
import { killCommand } from './commands/kill.js';
import { listCommand } from './commands/list.js';
import { statusCommand } from './commands/status.js';
import { monitorsCommand } from './commands/monitors.js';
import { voiceCommand } from './commands/voice.js';
import { runCommand } from './commands/run.js';

import type { PlatformAPI } from '../platform/types.js';

const program = new Command();

program
  .name('sworm')
  .version('0.2.0')
  .description('Spatially-aware desktop orchestration — deploy AI agents and apps across multi-monitor setups');

// Lazy-init platform and swarm so they're only created when a command needs them
let _platform: PlatformAPI | null = null;
let _swarm: Swarm | null = null;

function getPlatform(): PlatformAPI {
  if (!_platform) {
    _platform = createPlatform();
  }
  return _platform;
}

function getSwarm(): Swarm {
  if (!_swarm) {
    const platform = getPlatform();
    const registry = new WormTypeRegistry();

    registry.register('generic', GenericWorm);
    registry.register('claude', ClaudeWorm);
    registry.register('ide', IDEWorm);
    registry.register('app', AppWorm);
    registry.register('ai-agent', AIAgentWorm);

    _swarm = new Swarm(platform, registry);
  }
  return _swarm;
}

// Initialize hotkey manager for persistent commands
let _hotkeyManager: HotkeyManager | null = null;

function initHotkeys(): void {
  if (_hotkeyManager) return;
  _hotkeyManager = new HotkeyManager();
  const swarm = getSwarm();

  _hotkeyManager.onAction(async (action, args) => {
    try {
      switch (action) {
        case 'toggle-visibility':
          await swarm.toggleVisibility();
          break;
        case 'focus-worm': {
          const num = (args?.number as number) ?? 0;
          if (num > 0) await swarm.focusByNumber(num);
          break;
        }
        case 'toggle-fullscreen':
          // TODO: track focused worm for fullscreen toggle
          break;
        case 'kill-all':
          await swarm.kill();
          break;
        case 'deploy-default':
          await swarm.deploy('pilot');
          break;
      }
    } catch {
      // Silently ignore hotkey errors
    }
  });

  _hotkeyManager.start();
}

// Register all commands
deployCommand(program, getSwarm, getPlatform);
killCommand(program, getSwarm);
listCommand(program);
statusCommand(program, getSwarm);
monitorsCommand(program, getPlatform);
voiceCommand(program, getSwarm);
runCommand(program, getSwarm);

// Default action when no command is given: show status + available formations
if (process.argv.length <= 2) {
  import('chalk').then(({ default: chalk }) => {
    import('../config/loader.js').then(({ listFormations, loadFormation }) => {
      console.log(chalk.bold(`\n  SWORM v0.2.0`) + chalk.dim('  — spatially-aware desktop orchestration\n'));

      // Show active worms if any
      const swarm = getSwarm();
      const worms = swarm.status();
      if (worms.length > 0) {
        console.log(chalk.bold('  Active worms:'));
        for (const w of worms) {
          const status = w.status === 'running' || w.status === 'positioned'
            ? chalk.green(w.status) : chalk.yellow(w.status);
          console.log(`    [${w.number ?? '-'}] ${w.id} ${chalk.dim(w.type)} ${status}`);
        }
        console.log();
      }

      // Show formations
      try {
        const formations = listFormations();
        if (formations.length > 0) {
          console.log(chalk.bold('  Formations:'));
          for (const name of formations) {
            try {
              const config = loadFormation(name);
              const desc = config.description ? chalk.dim(` — ${config.description}`) : '';
              console.log(`    ${chalk.cyan(name)}${desc}`);
            } catch {
              console.log(`    ${chalk.cyan(name)}`);
            }
          }
          console.log();
        }
      } catch {}

      console.log(chalk.dim('  Quick start:'));
      console.log(chalk.dim('    sworm deploy pilot     Deploy a formation'));
      console.log(chalk.dim('    sworm run claude       Quick-launch Claude Code'));
      console.log(chalk.dim('    sworm run shell        Quick-launch a terminal'));
      console.log(chalk.dim('    sworm list             List formations with details'));
      console.log(chalk.dim('    sworm --help           All commands\n'));
    });
  });
} else {
  program.parse();
}
