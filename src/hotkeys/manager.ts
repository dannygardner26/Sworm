import { Win32HotkeyBackend } from './win32-hotkeys.js';
import { loadKeybindings } from './config.js';
import { parseKeyCombo, type Keybinding } from './types.js';

export type HotkeyHandler = (action: string, args?: Record<string, unknown>) => void;

export class HotkeyManager {
  private backend = new Win32HotkeyBackend();
  private bindings = new Map<number, Keybinding>(); // id -> binding
  private handler: HotkeyHandler | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private nextId = 1;

  start(): void {
    const config = loadKeybindings();
    if (!config.enabled) return;

    for (const binding of config.bindings) {
      try {
        const { modifiers, vk } = parseKeyCombo(binding.key);
        const id = this.nextId++;
        if (this.backend.register(id, modifiers, vk)) {
          this.bindings.set(id, binding);
        }
      } catch (e) {
        // Skip invalid bindings
        console.error(`Failed to register hotkey ${binding.key}:`, e);
      }
    }

    // Poll for hotkey messages every 50ms
    this.pollInterval = setInterval(() => {
      let hotkeyId: number | null;
      while ((hotkeyId = this.backend.poll()) !== null) {
        const binding = this.bindings.get(hotkeyId);
        if (binding && this.handler) {
          this.handler(binding.action, binding.args as Record<string, unknown> | undefined);
        }
      }
    }, 50);
  }

  onAction(handler: HotkeyHandler): void {
    this.handler = handler;
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.backend.dispose();
    this.bindings.clear();
  }
}
