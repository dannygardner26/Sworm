/**
 * Sworm settings — persisted to ~/.sworm/config.yaml
 * Covers voice activation, hotkeys, general preferences.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { z } from 'zod';

const SWORM_DIR = join(homedir(), '.sworm');
const CONFIG_PATH = join(SWORM_DIR, 'config.yaml');

const PushToTalkSchema = z.object({
  enabled: z.boolean().default(true),
  hotkey: z.string().default('ctrl+shift+space'),
  mode: z.enum(['hold', 'toggle', 'silence']).default('hold'),
  toggleHotkey: z.string().default('ctrl+tab+`'),
});

const WakeWordSchema = z.object({
  enabled: z.boolean().default(false),
  phrase: z.string().default('sworm'),
});

const WhisperSchema = z.object({
  binaryPath: z.string().default(''),
  modelPath: z.string().default(''),
  sampleRate: z.number().default(16000),
});

const FeedbackSchema = z.object({
  chimeOnListen: z.boolean().default(true),
  chimeOnAcknowledge: z.boolean().default(true),
});

export const VoiceSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  pushToTalk: PushToTalkSchema.default({ enabled: true, hotkey: 'ctrl+shift+space', mode: 'hold', toggleHotkey: 'ctrl+tab+`' }),
  wakeWord: WakeWordSchema.default({ enabled: false, phrase: 'sworm' }),
  whisper: WhisperSchema.default({ binaryPath: '', modelPath: '', sampleRate: 16000 }),
  recorder: z.enum(['sox', 'ffmpeg']).default('sox'),
  pttTimeout: z.number().default(5000),
  silenceChunks: z.number().default(3),
  feedback: FeedbackSchema.default({ chimeOnListen: true, chimeOnAcknowledge: true }),
});

export const HotkeySettingsSchema = z.object({
  enabled: z.boolean().default(true),
  bindings: z
    .array(
      z.object({
        key: z.string(),
        action: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .default([]),
});

export const GeneralSettingsSchema = z.object({
  defaultFormation: z.string().default('pilot'),
  formationsDir: z.string().optional(),
  theme: z.enum(['dark', 'light']).default('dark'),
});

export const SwormSettingsSchema = z.object({
  voice: VoiceSettingsSchema.default({
    enabled: false,
    pushToTalk: { enabled: true, hotkey: 'ctrl+shift+space', mode: 'hold' as const, toggleHotkey: 'ctrl+tab+`' },
    wakeWord: { enabled: false, phrase: 'sworm' },
    whisper: { binaryPath: '', modelPath: '', sampleRate: 16000 },
    recorder: 'sox' as const,
    pttTimeout: 5000,
    silenceChunks: 3,
    feedback: { chimeOnListen: true, chimeOnAcknowledge: true },
  }),
  hotkeys: HotkeySettingsSchema.default({ enabled: true, bindings: [] }),
  general: GeneralSettingsSchema.default({ defaultFormation: 'pilot', theme: 'dark' as const }),
});

export type SwormSettings = z.infer<typeof SwormSettingsSchema>;
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;
export type HotkeySettings = z.infer<typeof HotkeySettingsSchema>;
export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;

/** Load settings from disk, returning defaults if file doesn't exist. */
export function loadSettings(): SwormSettings {
  if (!existsSync(CONFIG_PATH)) {
    return SwormSettingsSchema.parse({});
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = parseYaml(raw);
    return SwormSettingsSchema.parse(parsed ?? {});
  } catch {
    return SwormSettingsSchema.parse({});
  }
}

/** Save settings to disk. */
export function saveSettings(settings: SwormSettings): void {
  mkdirSync(SWORM_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, toYaml(settings, { indent: 2 }), 'utf-8');
}

/** Update a specific section of settings. */
export function updateSettings(patch: Partial<SwormSettings>): SwormSettings {
  const current = loadSettings();
  const merged = {
    ...current,
    ...patch,
    voice: patch.voice ? { ...current.voice, ...patch.voice } : current.voice,
    hotkeys: patch.hotkeys ? { ...current.hotkeys, ...patch.hotkeys } : current.hotkeys,
    general: patch.general ? { ...current.general, ...patch.general } : current.general,
  };
  const validated = SwormSettingsSchema.parse(merged);
  saveSettings(validated);
  return validated;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
