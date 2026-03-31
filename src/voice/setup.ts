/**
 * Voice setup — auto-download whisper.cpp binary + tiny.en model.
 */
import { existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { get as httpsGet } from 'node:https';

const SWORM_DIR = join(homedir(), '.sworm');
const VOICE_DIR = join(SWORM_DIR, 'voice');
const MODEL_DIR = join(VOICE_DIR, 'models');

const WHISPER_BIN_URL =
  'https://github.com/ggerganov/whisper.cpp/releases/latest/download/whisper-bin-x64.zip';
const TINY_EN_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin';

export interface VoiceSetupPaths {
  whisperPath: string;
  modelPath: string;
}

export function getVoicePaths(): VoiceSetupPaths {
  return {
    whisperPath: join(VOICE_DIR, 'whisper-cli.exe'),
    modelPath: join(MODEL_DIR, 'ggml-tiny.en.bin'),
  };
}

export function isVoiceSetup(): boolean {
  const paths = getVoicePaths();
  return existsSync(paths.whisperPath) && existsSync(paths.modelPath);
}

export async function setupVoice(
  onProgress?: (msg: string) => void,
): Promise<VoiceSetupPaths> {
  const log = onProgress ?? (() => {});
  const paths = getVoicePaths();

  // Ensure directories
  mkdirSync(MODEL_DIR, { recursive: true });

  // Download whisper.cpp binary if missing
  if (!existsSync(paths.whisperPath)) {
    log('Downloading whisper.cpp binary...');

    // Try winget or scoop first
    let installed = false;

    try {
      execSync('where whisper-cli', { stdio: 'pipe' });
      // Already in PATH — just use it
      paths.whisperPath = 'whisper-cli';
      installed = true;
      log('Found whisper-cli in PATH.');
    } catch {
      // Not in PATH, try downloading
    }

    if (!installed) {
      const zipPath = join(VOICE_DIR, 'whisper-bin-x64.zip');

      try {
        await downloadFile(WHISPER_BIN_URL, zipPath, log);
        log('Extracting whisper.cpp...');
        execSync(
          `powershell -Command "Expand-Archive -Force '${zipPath}' '${VOICE_DIR}'"`,
          { stdio: 'pipe' },
        );
        // Find any whisper exe in extracted files (may be whisper-cli.exe, main.exe, etc.)
        const { readdirSync, renameSync, copyFileSync } = await import('node:fs');
        const findExe = (dir: string): string | null => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.match(/^(whisper[-_]?cli|main|whisper)\.exe$/i)) {
              return join(dir, entry.name);
            }
            if (entry.isDirectory()) {
              const found = findExe(join(dir, entry.name));
              if (found) return found;
            }
          }
          return null;
        };
        const exe = findExe(VOICE_DIR);
        if (exe) {
          if (exe !== paths.whisperPath) {
            copyFileSync(exe, paths.whisperPath);
          }
          log('whisper-cli installed.');
        } else {
          // List what we found for debugging
          const listExes = (dir: string): string[] => {
            const results: string[] = [];
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
              if (entry.isFile() && entry.name.endsWith('.exe')) results.push(join(dir, entry.name));
              if (entry.isDirectory()) results.push(...listExes(join(dir, entry.name)));
            }
            return results;
          };
          const found = listExes(VOICE_DIR);
          log(`No whisper exe found. Files found: ${found.join(', ')}`);
          throw new Error('Could not find whisper executable in downloaded archive');
        }
        // Cleanup zip
        try { const { unlinkSync } = await import('node:fs'); unlinkSync(zipPath); } catch {}
      } catch (err) {
        log(`Failed to auto-download whisper.cpp: ${err instanceof Error ? err.message : String(err)}`);
        log('Please install whisper.cpp manually:');
        log('  https://github.com/ggerganov/whisper.cpp/releases');
        log(`  Place whisper-cli.exe in: ${VOICE_DIR}`);
        throw new Error('whisper.cpp binary not available');
      }
    }
  } else {
    log('whisper-cli binary: OK');
  }

  // Download model if missing
  if (!existsSync(paths.modelPath)) {
    log('Downloading tiny.en model (~75MB)...');
    try {
      await downloadFile(TINY_EN_MODEL_URL, paths.modelPath, log);
      log('Model downloaded.');
    } catch (err) {
      log(`Failed to download model: ${err instanceof Error ? err.message : String(err)}`);
      log('Please download manually:');
      log(`  ${TINY_EN_MODEL_URL}`);
      log(`  Save to: ${paths.modelPath}`);
      throw new Error('Whisper model not available');
    }
  } else {
    log('Whisper model: OK');
  }

  return paths;
}

function downloadFile(
  url: string,
  dest: string,
  log: (msg: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (url: string, redirects = 0) => {
      if (redirects > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const mod = url.startsWith('https') ? httpsGet : require('node:http').get;
      mod(url, (res: any) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location, redirects + 1);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
          return;
        }

        const total = parseInt(res.headers['content-length'] ?? '0', 10);
        let downloaded = 0;
        let lastPct = 0;

        const file = createWriteStream(dest);
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = Math.floor((downloaded / total) * 100);
            if (pct >= lastPct + 10) {
              log(`  ${pct}%`);
              lastPct = pct;
            }
          }
        });
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      }).on('error', reject);
    };

    follow(url);
  });
}
