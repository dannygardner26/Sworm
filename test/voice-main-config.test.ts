import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('main-process voice configuration', () => {
  const mainPath = join(process.cwd(), 'app', 'main.ts');
  const source = readFileSync(mainPath, 'utf8');

  it('does not hardcode whisper binary and model paths as the runtime source of truth', () => {
    expect(source).not.toContain("const WHISPER_PATH = join(WHISPER_DIR, 'whisper-cli.exe')");
    expect(source).not.toContain("const MODEL_PATH = join(WHISPER_DIR, 'models', 'ggml-tiny.en.bin')");
  });

  it('uses the shared settings module instead of bespoke config loading in the main process', () => {
    expect(source).toContain("from '../src/config/settings'");
    expect(source).not.toContain('function readSettings()');
    expect(source).not.toContain('const yaml = require(\'yaml\')');
  });

  it('does not use synchronous whisper transcription in the live recording path', () => {
    expect(source).not.toContain('const result = spawnSync(whisperPath, [');
    expect(source).not.toContain("mainWindow?.webContents.send('voice:status', 'error', 'No speech detected')");
  });
});
