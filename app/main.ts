/**
 * Sworm — Electron Main Process
 * Spawns PTY server as child process (system Node) to avoid ABI mismatch.
 */
import { app, BrowserWindow, ipcMain, globalShortcut, Menu } from 'electron';
import { spawn, execSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { existsSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

let mainWindow: BrowserWindow | null = null;
let ptyProcess: ReturnType<typeof spawn> | null = null;
let paneCounter = 0;

// Pending IPC responses
const pending = new Map<string, (result: any) => void>();

function startPtyServer() {
  // Use system Node (not Electron's) to run pty-server.cjs
  const nodePath = process.platform === 'win32' ? 'node' : 'node';
  const serverPath = join(__dirname, '..', 'app', 'pty-server.cjs');

  ptyProcess = spawn(nodePath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  ptyProcess.stderr?.on('data', (data: Buffer) => {
    console.error('[pty-server]', data.toString());
  });

  // Read JSON messages from pty-server stdout
  const rl = createInterface({ input: ptyProcess.stdout! });
  rl.on('line', (line: string) => {
    try {
      const msg = JSON.parse(line);
      switch (msg.type) {
        case 'ready':
          console.log('[Sworm] PTY server ready');
          break;
        case 'created': {
          const resolve = pending.get(`create:${msg.id}`);
          if (resolve) {
            resolve({ id: msg.id, pid: msg.pid });
            pending.delete(`create:${msg.id}`);
          }
          break;
        }
        case 'data':
          mainWindow?.webContents.send('pty:data', msg.id, msg.data);
          break;
        case 'exit':
          mainWindow?.webContents.send('pty:exit', msg.id, msg.exitCode);
          break;
        case 'error':
          console.error('[pty-server]', msg.error);
          break;
      }
    } catch {
      // ignore parse errors
    }
  });

  ptyProcess.on('exit', (code: number | null) => {
    console.log(`[Sworm] PTY server exited with code ${code}`);
  });
}

function sendToPty(msg: any) {
  ptyProcess?.stdin?.write(JSON.stringify(msg) + '\n');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    frame: false,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a1a',
      symbolColor: '#888',
      height: 32,
    },
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  mainWindow.maximize();

  mainWindow.loadFile(join(__dirname, '..', 'app', 'renderer', 'index.html'));

  // Open DevTools with F12
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    ptyProcess?.kill();
  });
}

// ─── IPC Handlers ───────────────────────────────────────────

ipcMain.handle('pty:create', (_event, opts: {
  id?: string;
  cmd?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}) => {
  const id = opts.id || `pane-${++paneCounter}`;

  return new Promise((resolve) => {
    pending.set(`create:${id}`, resolve);
    sendToPty({
      type: 'create',
      id,
      cmd: opts.cmd,
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
    });

    // Timeout after 10s
    setTimeout(() => {
      if (pending.has(`create:${id}`)) {
        pending.delete(`create:${id}`);
        resolve({ id, pid: -1 });
      }
    }, 10000);
  });
});

ipcMain.on('pty:write', (_event, id: string, data: string) => {
  sendToPty({ type: 'write', id, data });
});

ipcMain.on('pty:resize', (_event, id: string, cols: number, rows: number) => {
  sendToPty({ type: 'resize', id, cols, rows });
});

ipcMain.on('pty:kill', (_event, id: string) => {
  sendToPty({ type: 'kill', id });
});

ipcMain.handle('pty:list', () => {
  return [];
});

// Launch external applications
ipcMain.handle('app:launch', (_event, opts: { exe: string; args?: string[] }) => {
  try {
    const child = spawn(opts.exe, opts.args || [], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('git:worktree', (_event, opts: {
  repo: string;
  branch: string;
  id: string;
}) => {
  const worktreePath = join(opts.repo, '..', `sworm-${opts.id}-${opts.branch}`);
  try {
    execSync(`git -C "${opts.repo}" worktree add "${worktreePath}" -b ${opts.branch}`, { stdio: 'pipe' });
  } catch {
    try {
      execSync(`git -C "${opts.repo}" worktree add "${worktreePath}" ${opts.branch}`, { stdio: 'pipe' });
    } catch (e) {
      return { error: String(e) };
    }
  }
  return { path: worktreePath };
});

// ─── Settings IPC ──────────��───────────────────────────

ipcMain.handle('settings:read', () => {
  try {
    const { readFileSync, existsSync } = require('fs');
    const { join } = require('path');
    const { homedir } = require('os');
    const yaml = require('yaml');
    const configPath = join(homedir(), '.sworm', 'config.yaml');
    if (!existsSync(configPath)) {
      // Return defaults
      return {
        voice: {
          enabled: false,
          pushToTalk: { enabled: true, hotkey: 'ctrl+shift+space' },
          wakeWord: { enabled: false, phrase: 'sworm' },
          whisper: { binaryPath: '', modelPath: '', sampleRate: 16000 },
          recorder: 'sox',
          pttTimeout: 5000,
          silenceChunks: 3,
          feedback: { chimeOnListen: true, chimeOnAcknowledge: true },
        },
        hotkeys: {
          enabled: true,
          bindings: [
            { key: 'ctrl+shift+space', action: 'voice-activate' },
            { key: 'ctrl+shift+s', action: 'toggle-visibility' },
            { key: 'ctrl+shift+k', action: 'kill-all' },
            { key: 'ctrl+shift+d', action: 'deploy-default' },
            { key: 'ctrl+shift+f', action: 'toggle-fullscreen' },
          ],
        },
        general: {
          defaultFormation: 'pilot',
          formationsDir: '',
          theme: 'dark',
        },
      };
    }
    const raw = readFileSync(configPath, 'utf-8');
    return yaml.parse(raw) || {};
  } catch {
    return {};
  }
});

ipcMain.handle('settings:write', (_event, settings: any) => {
  try {
    const { writeFileSync, mkdirSync } = require('fs');
    const { join } = require('path');
    const { homedir } = require('os');
    const yaml = require('yaml');
    const dir = join(homedir(), '.sworm');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.yaml'), yaml.stringify(settings, { indent: 2 }), 'utf-8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// ─── Voice Activation ──────────────────────────────────────

let voiceRecording = false;
let voiceProcess: ReturnType<typeof spawn> | null = null;
let currentWavPath: string | null = null;
const voiceTempDir = mkdtempSync(join(tmpdir(), 'sworm-voice-'));
const WHISPER_PATH = join(homedir(), '.sworm', 'voice', 'whisper-cli.exe');
const MODEL_PATH = join(homedir(), '.sworm', 'voice', 'models', 'ggml-tiny.en.bin');

let cachedMicName: string | null = null;
function getDefaultMic(): string {
  if (cachedMicName) return cachedMicName;
  try {
    const result = spawnSync('ffmpeg', ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
      timeout: 5000,
    });
    const output = result.stderr?.toString() || '';
    const match = output.match(/"([^"]+)"\s*\(audio\)/);
    if (match) {
      cachedMicName = match[1];
      return cachedMicName;
    }
  } catch {}
  return 'Microphone';
}

function isWhisperReady(): boolean {
  return existsSync(WHISPER_PATH) && existsSync(MODEL_PATH);
}

function startVoiceRecording() {
  if (voiceRecording) return; // Use toggleVoice for toggle behavior

  if (!isWhisperReady()) {
    mainWindow?.webContents.send('voice:status', 'error', 'Whisper not set up. Run: sworm voice setup');
    return;
  }

  voiceRecording = true;
  mainWindow?.webContents.send('voice:status', 'listening', '');
  console.log('[Voice] Recording...');

  const wavPath = join(voiceTempDir, `voice-${Date.now()}.wav`);
  currentWavPath = wavPath;
  const micName = getDefaultMic();

  voiceProcess = spawn('ffmpeg', [
    '-f', 'dshow',
    '-i', `audio=${micName}`,
    '-ar', '16000',
    '-ac', '1',
    '-t', '8',
    '-y',
    wavPath,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  voiceProcess.on('close', () => {
    if (currentWavPath) {
      const path = currentWavPath;
      currentWavPath = null;
      voiceRecording = false;
      transcribeAndExecute(path);
    } else {
      voiceRecording = false;
      mainWindow?.webContents.send('voice:status', 'idle', '');
    }
  });

  voiceProcess.on('error', (err) => {
    console.error('[Voice] FFmpeg error:', err.message);
    voiceRecording = false;
    mainWindow?.webContents.send('voice:status', 'error', 'Mic capture failed: ' + err.message);
  });
}

function stopVoiceRecording() {
  if (!voiceRecording) return;
  console.log('[Voice] Stop recording');

  // Send 'q' to ffmpeg to stop gracefully — this triggers the 'close' handler which transcribes
  if (voiceProcess) {
    try { voiceProcess.stdin?.write('q'); } catch {}
    setTimeout(() => {
      try { if (voiceProcess && !voiceProcess.killed) voiceProcess.kill(); } catch {}
    }, 1000);
  }
}

/** Toggle: start if idle, stop if recording */
function toggleVoice() {
  if (voiceRecording) {
    stopVoiceRecording();
  } else {
    startVoiceRecording();
  }
}

function transcribeAndExecute(wavPath: string) {
  mainWindow?.webContents.send('voice:status', 'processing', '');
  console.log('[Voice] Transcribing...');

  if (!existsSync(wavPath)) {
    mainWindow?.webContents.send('voice:status', 'idle', '');
    return;
  }

  const result = spawnSync(WHISPER_PATH, [
    '-m', MODEL_PATH,
    '-f', wavPath,
    '-l', 'en',
    '--no-timestamps',
  ], { timeout: 15000 });

  try { unlinkSync(wavPath); } catch {}

  let text = result.stdout?.toString().trim() || '';
  // Strip whisper artifacts
  text = text.replace(/\[BLANK_AUDIO\]/g, '').replace(/\(.*?\)/g, '').trim();
  console.log('[Voice] Result:', text || '(empty)');

  if (text) {
    mainWindow?.webContents.send('voice:result', text);
  } else {
    mainWindow?.webContents.send('voice:status', 'error', 'No speech detected');
    setTimeout(() => mainWindow?.webContents.send('voice:status', 'idle', ''), 2000);
    return;
  }
  mainWindow?.webContents.send('voice:status', 'idle', '');
}

function registerVoiceShortcuts() {
  // Ctrl+F9 = toggle: press to start, press again to stop
  const cf9ok = globalShortcut.register('Ctrl+F9', () => {
    console.log('[Voice] Ctrl+F9 toggle');
    toggleVoice();
  });
  console.log('[Voice] Ctrl+F9 toggle:', cf9ok ? 'OK' : 'TAKEN');

  // F9 = hold-to-talk: record while held, stop on release
  // globalShortcut can't detect keyup, so we use before-input-event on the window
  // AND register F9 globally to capture it even when app isn't focused
  let f9Held = false;
  const f9ok = globalShortcut.register('F9', () => {
    // Global F9 keydown — start recording if not already
    if (!f9Held) {
      f9Held = true;
      console.log('[Voice] F9 held (start)');
      if (!voiceRecording) startVoiceRecording();
    }
  });
  console.log('[Voice] F9 hold-to-talk:', f9ok ? 'OK' : 'TAKEN');

  // Detect F9 keyup via polling — globalShortcut fires repeatedly while held,
  // so we detect "release" when it stops firing for >200ms
  if (f9ok) {
    let lastF9Time = 0;
    const origHandler = globalShortcut.isRegistered('F9');
    // Override: track last fire time
    globalShortcut.unregister('F9');
    globalShortcut.register('F9', () => {
      lastF9Time = Date.now();
      if (!f9Held) {
        f9Held = true;
        console.log('[Voice] F9 held (start)');
        if (!voiceRecording) startVoiceRecording();
      }
    });
    // Poll to detect release (no repeat fires for 250ms = released)
    setInterval(() => {
      if (f9Held && Date.now() - lastF9Time > 250) {
        f9Held = false;
        console.log('[Voice] F9 released (stop)');
        if (voiceRecording) stopVoiceRecording();
      }
    }, 100);
  }

  const label = (f9ok ? 'F9 hold' : '') + (f9ok && cf9ok ? ' | ' : '') + (cf9ok ? 'Ctrl+F9 toggle' : '');
  mainWindow?.webContents.send('voice:shortcut', label || 'none');
  return label;
}

// IPC for voice from renderer
ipcMain.on('voice:start', () => startVoiceRecording());
ipcMain.on('voice:stop', () => stopVoiceRecording());

// ─── App Lifecycle ──────────────────────────────────────────

app.whenReady().then(() => {
  // Remove default menu bar
  Menu.setApplicationMenu(null);

  startPtyServer();
  createWindow();
  const shortcuts = registerVoiceShortcuts();
  console.log(`[Sworm] Voice: ${shortcuts}`);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  ptyProcess?.kill();
  app.quit();
});
