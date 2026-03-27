import { z } from 'zod';

export interface HotkeyAction {
  name: string;
  args?: Record<string, unknown>;
}

export const KeybindingSchema = z.object({
  key: z.string(),              // e.g., "ctrl+shift+s"
  action: z.string(),           // e.g., "toggle-visibility"
  args: z.record(z.string(), z.unknown()).optional(),
});
export type Keybinding = z.infer<typeof KeybindingSchema>;

export const KeybindingsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  bindings: z.array(KeybindingSchema),
});
export type KeybindingsConfig = z.infer<typeof KeybindingsConfigSchema>;

// Win32 modifier constants
export const MOD_ALT = 0x0001;
export const MOD_CONTROL = 0x0002;
export const MOD_SHIFT = 0x0004;
export const MOD_WIN = 0x0008;
export const MOD_NOREPEAT = 0x4000;

// Common virtual key codes
export const VK_MAP: Record<string, number> = {
  '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
  '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,
  'a': 0x41, 'b': 0x42, 'c': 0x43, 'd': 0x44, 'e': 0x45,
  'f': 0x46, 'g': 0x47, 'h': 0x48, 'i': 0x49, 'j': 0x4A,
  'k': 0x4B, 'l': 0x4C, 'm': 0x4D, 'n': 0x4E, 'o': 0x4F,
  'p': 0x50, 'q': 0x51, 'r': 0x52, 's': 0x53, 't': 0x54,
  'u': 0x55, 'v': 0x56, 'w': 0x57, 'x': 0x58, 'y': 0x59, 'z': 0x5A,
  'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73,
  'f5': 0x74, 'f6': 0x75, 'f7': 0x76, 'f8': 0x77,
  'space': 0x20, 'enter': 0x0D, 'escape': 0x1B, 'tab': 0x09,
};

export function parseKeyCombo(key: string): { modifiers: number; vk: number } {
  const parts = key.toLowerCase().split('+').map(p => p.trim());
  let modifiers = 0;
  let vk = 0;

  for (const part of parts) {
    switch (part) {
      case 'ctrl': case 'control': modifiers |= MOD_CONTROL; break;
      case 'shift': modifiers |= MOD_SHIFT; break;
      case 'alt': modifiers |= MOD_ALT; break;
      case 'win': case 'super': modifiers |= MOD_WIN; break;
      default: {
        const code = VK_MAP[part];
        if (code !== undefined) vk = code;
        else throw new Error(`Unknown key: ${part}`);
      }
    }
  }

  if (vk === 0) throw new Error(`No key specified in combo: ${key}`);
  return { modifiers: modifiers | MOD_NOREPEAT, vk };
}
