import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { KeybindingsConfigSchema, type KeybindingsConfig, type Keybinding } from './types.js';

const DEFAULT_BINDINGS: Keybinding[] = [
  { key: 'ctrl+shift+s', action: 'toggle-visibility' },
  { key: 'ctrl+shift+1', action: 'focus-worm', args: { number: 1 } },
  { key: 'ctrl+shift+2', action: 'focus-worm', args: { number: 2 } },
  { key: 'ctrl+shift+3', action: 'focus-worm', args: { number: 3 } },
  { key: 'ctrl+shift+4', action: 'focus-worm', args: { number: 4 } },
  { key: 'ctrl+shift+5', action: 'focus-worm', args: { number: 5 } },
  { key: 'ctrl+shift+6', action: 'focus-worm', args: { number: 6 } },
  { key: 'ctrl+shift+7', action: 'focus-worm', args: { number: 7 } },
  { key: 'ctrl+shift+8', action: 'focus-worm', args: { number: 8 } },
  { key: 'ctrl+shift+9', action: 'focus-worm', args: { number: 9 } },
  { key: 'ctrl+shift+f', action: 'toggle-fullscreen' },
  { key: 'ctrl+shift+k', action: 'kill-all' },
  { key: 'ctrl+shift+d', action: 'deploy-default' },
];

export function loadKeybindings(): KeybindingsConfig {
  const configPath = join(homedir(), '.sworm', 'keybindings.yaml');

  if (!existsSync(configPath)) {
    return { enabled: true, bindings: DEFAULT_BINDINGS };
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw);
  return KeybindingsConfigSchema.parse(parsed);
}

export { DEFAULT_BINDINGS };
