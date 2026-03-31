import { KeyboardHookBackend } from './keyboard-hook.js';
import { loadKeybindings } from './config.js';
import { parseKeyComboRaw, type Keybinding, type HotkeyEventType } from './types.js';

export type HotkeyHandler = (
  action: string,
  eventType: HotkeyEventType,
  args?: Record<string, unknown>,
) => void;

interface ParsedBinding {
  action: string;
  mode: 'press' | 'hold';
  keys: number[]; // non-modifier VK codes
  modifierKeys: [number, number][]; // pairs of [left, right] VKs per modifier
  totalKeyCount: number; // keys.length + modifierKeys.length — for specificity sort
  args?: Record<string, unknown>;
}

export class HotkeyManager {
  private backend = new KeyboardHookBackend();
  private bindings: ParsedBinding[] = [];
  private handler: HotkeyHandler | null = null;
  private pumpInterval: ReturnType<typeof setInterval> | null = null;

  // Track currently pressed VK codes
  private pressedKeys = new Set<number>();
  // Track which hold-mode actions are currently active
  private activeHolds = new Map<string, boolean>();

  start(): void {
    const config = loadKeybindings();
    if (!config.enabled) return;

    // Parse all bindings
    for (const binding of config.bindings) {
      try {
        const { keys, modifierKeys } = parseKeyComboRaw(binding.key);
        this.bindings.push({
          action: binding.action,
          mode: (binding.mode as 'press' | 'hold') ?? 'press',
          keys,
          modifierKeys,
          totalKeyCount: keys.length + modifierKeys.length,
          args: binding.args as Record<string, unknown> | undefined,
        });
      } catch (e) {
        console.error(`Failed to parse hotkey ${binding.key}:`, e);
      }
    }

    // Sort by specificity: most keys first (most specific matches win)
    this.bindings.sort((a, b) => b.totalKeyCount - a.totalKeyCount);

    // Install the low-level keyboard hook
    this.backend.install((vk, type) => {
      if (type === 'down') {
        return this.handleKeyDown(vk);
      } else {
        return this.handleKeyUp(vk);
      }
    });

    // Pump messages every 50ms so the hook callback fires
    this.pumpInterval = setInterval(() => {
      this.backend.pumpMessages();
    }, 50);
  }

  onAction(handler: HotkeyHandler): void {
    this.handler = handler;
  }

  stop(): void {
    if (this.pumpInterval) {
      clearInterval(this.pumpInterval);
      this.pumpInterval = null;
    }
    this.backend.uninstall();
    this.bindings = [];
    this.pressedKeys.clear();
    this.activeHolds.clear();
  }

  private comboMatches(binding: ParsedBinding): boolean {
    // All non-modifier keys must be pressed
    for (const k of binding.keys) {
      if (!this.pressedKeys.has(k)) return false;
    }
    // For each modifier, at least one of [left, right] must be pressed
    for (const [left, right] of binding.modifierKeys) {
      if (!this.pressedKeys.has(left) && !this.pressedKeys.has(right)) return false;
    }
    return true;
  }

  private handleKeyDown(vk: number): boolean {
    this.pressedKeys.add(vk);

    for (const binding of this.bindings) {
      if (!this.comboMatches(binding)) continue;

      if (binding.mode === 'press') {
        this.handler?.(binding.action, 'press', binding.args);
        return true;
      }

      if (binding.mode === 'hold') {
        if (!this.activeHolds.get(binding.action)) {
          this.activeHolds.set(binding.action, true);
          this.handler?.(binding.action, 'hold-start', binding.args);
        }
        return true;
      }
    }

    return false;
  }

  private handleKeyUp(vk: number): boolean {
    this.pressedKeys.delete(vk);

    // Check all active holds — if their combo is no longer fully pressed, end them
    for (const [action, active] of this.activeHolds) {
      if (!active) continue;

      const binding = this.bindings.find((b) => b.action === action && b.mode === 'hold');
      if (binding && !this.comboMatches(binding)) {
        this.activeHolds.set(action, false);
        this.handler?.(action, 'hold-end', binding.args);
      }
    }

    return false;
  }
}
