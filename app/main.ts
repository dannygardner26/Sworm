/**
 * Sworm — Electron Main Process
 * Spawns PTY server as child process (system Node) to avoid ABI mismatch.
 */
import { app, BrowserWindow, ipcMain, globalShortcut, Menu, nativeImage } from 'electron';
import { spawn, execSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdtempSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const LOG_PATH = join(tmpdir(), 'sworm-debug.log');
function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_PATH, line + '\n'); } catch {}
}

log('[Sworm] Main process starting...');
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
          log('[Sworm] PTY server ready');
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
  // Load icon from multiple possible locations
  const iconPaths = [
    join(__dirname, 'sworm-icon.ico'),
    join(__dirname, '..', 'app', 'sworm-icon.ico'),
    join(__dirname, '..', 'logos', 'sworm-icon.png'),
  ];
  const iconPath = iconPaths.find(p => existsSync(p)) || iconPaths[0];
  const appIcon = nativeImage.createFromPath(iconPath);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    frame: false,
    icon: appIcon,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0a',
      symbolColor: '#333',
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

// ─── Voice (local whisper transcription) ─────────────────

let voiceRecording = false;
let voiceRecordStart = 0;
let voiceProcess: ReturnType<typeof spawn> | null = null;
const voiceTempDir = mkdtempSync(join(tmpdir(), 'sworm-voice-'));
const WHISPER_DIR = join(homedir(), '.sworm', 'voice');
const WHISPER_PATH = join(WHISPER_DIR, 'whisper-cli.exe');
const MODEL_PATH = join(WHISPER_DIR, 'models', 'ggml-tiny.en.bin');

let cachedMicName: string | null = null;
function getDefaultMic(): string {
  if (cachedMicName) return cachedMicName;
  try {
    const result = spawnSync('ffmpeg', ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { timeout: 5000 });
    const output = result.stderr?.toString() || '';
    const match = output.match(/"([^"]+)"\s*\(audio\)/);
    if (match) { cachedMicName = match[1]; return cachedMicName; }
  } catch {}
  return 'Microphone';
}

function startVoiceRecording() {
  if (voiceRecording) return;
  if (!existsSync(WHISPER_PATH) || !existsSync(MODEL_PATH)) {
    mainWindow?.webContents.send('voice:status', 'error', 'Whisper not set up');
    return;
  }

  voiceRecording = true;
  voiceRecordStart = Date.now();
  const wavPath = join(voiceTempDir, `voice-${Date.now()}.wav`);
  mainWindow?.webContents.send('voice:status', 'listening', '');
  log('[Voice] Recording...');

  const micName = getDefaultMic();
  voiceProcess = spawn('ffmpeg', [
    '-f', 'dshow', '-i', `audio=${micName}`,
    '-ar', '16000', '-ac', '1', '-y', wavPath,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  voiceProcess.on('error', (err) => {
    log(`[Voice] FFmpeg error: ${err.message}`);
    voiceRecording = false;
    mainWindow?.webContents.send('voice:status', 'error', 'Mic capture failed');
  });

  // Store path for stop handler
  (voiceProcess as any)._wavPath = wavPath;
}

function stopVoiceRecording() {
  if (!voiceRecording || !voiceProcess) return;
  voiceRecording = false;
  log('[Voice] Stop recording');

  const proc = voiceProcess;
  const wavPath = (proc as any)._wavPath;
  voiceProcess = null;

  try { proc.stdin?.write('q'); } catch {}

  mainWindow?.webContents.send('voice:status', 'processing', '');

  // Wait for ffmpeg to finish writing, then transcribe
  proc.on('close', () => {
    if (!existsSync(wavPath)) {
      mainWindow?.webContents.send('voice:status', 'error', 'No audio recorded');
      return;
    }

    log('[Voice] Transcribing...');
    const result = spawnSync(WHISPER_PATH, [
      '-m', MODEL_PATH, '-f', wavPath, '-l', 'en', '--no-timestamps',
    ], { timeout: 15000, cwd: WHISPER_DIR });

    try { unlinkSync(wavPath); } catch {}
    let text = result.stdout?.toString().trim() || '';
    text = text.replace(/\[BLANK_AUDIO\]/g, '').replace(/\(.*?\)/g, '').trim();
    // Filter whisper hallucinations (common on silence/noise)
    const hallucinations = /^(thank|thanks|subscribe|like|comment|share|you|bye|see you|please|okay|so|the end|\.+|\s*)$/i;
    if (hallucinations.test(text)) text = '';
    log(`[Voice] Result: ${text || '(empty)'}`);

    if (text) {
      mainWindow?.webContents.send('voice:result', text);
    } else {
      mainWindow?.webContents.send('voice:status', 'error', 'No speech detected');
    }
  });

  setTimeout(() => { try { if (!proc.killed) proc.kill(); } catch {} }, 2000);
}

function toggleVoice() {
  if (voiceRecording) stopVoiceRecording(); else startVoiceRecording();
}

// ─── Global Shortcuts ────────────────────────────────────

function tryRegister(combos: string[], handler: () => void): string | null {
  for (const combo of combos) {
    const ok = globalShortcut.register(combo, handler);
    if (ok) { log(`[Shortcut] Registered: ${combo}`); return combo; }
    log(`[Shortcut] ${combo} TAKEN, trying next...`);
  }
  return null;
}

function registerGlobalShortcuts() {
  // Toggle voice: Ctrl+Alt+V — tap to start listening, tap to stop
  let lastToggle = 0;
  const toggleKey = tryRegister(['Ctrl+Alt+V', 'F9'], () => {
    const now = Date.now();
    if (now - lastToggle < 300) return;
    lastToggle = now;
    log('[Voice] Toggle pressed');
    toggleVoice();
  });

  // Push-to-talk: Alt+V — hold to record, release to stop
  // globalShortcut fires repeatedly while held; we detect release when repeats stop
  let pttKey: string | null = null;
  let pttLastFire = 0;
  let pttActive = false;

  for (const combo of ['Alt+V', 'F10']) {
    const ok = globalShortcut.register(combo, () => {
      pttLastFire = Date.now();
      if (!pttActive) {
        pttActive = true;
        log(`[Voice] PTT hold start`);
        if (!voiceRecording) startVoiceRecording();
      }
    });
    if (ok) {
      pttKey = combo;
      log(`[Shortcut] Registered PTT: ${combo}`);
      // Poll: if no repeat fires for 300ms, key was released
      setInterval(() => {
        if (pttActive && Date.now() - pttLastFire > 300) {
          pttActive = false;
          log(`[Voice] PTT released`);
          if (voiceRecording) stopVoiceRecording();
        }
      }, 50);
      break;
    }
    log(`[Shortcut] ${combo} TAKEN, trying next...`);
  }

  // Toggle window visibility: Ctrl+`
  const windowKey = tryRegister(
    ['Ctrl+`', 'F8'],
    () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) { mainWindow.hide(); } else { mainWindow.show(); mainWindow.focus(); }
    },
  );

  const parts: string[] = [];
  if (pttKey) parts.push(`${pttKey} push-to-talk`);
  if (toggleKey) parts.push(`${toggleKey} toggle voice`);
  if (windowKey) parts.push(`${windowKey} toggle window`);
  const label = parts.join(' | ') || 'no shortcuts available';
  currentShortcutLabel = label;
  mainWindow?.webContents.send('voice:shortcut', label);
  log(`[Sworm] Global shortcuts: ${label}`);
  return label;
}

let currentShortcutLabel = '';
ipcMain.on('voice:start', () => startVoiceRecording());
ipcMain.on('voice:stop', () => stopVoiceRecording());
ipcMain.on('voice:ready', () => {
  if (currentShortcutLabel) mainWindow?.webContents.send('voice:shortcut', currentShortcutLabel);
});

// ─── Brain (LLM command interpretation) ──────────────────

let brain: any = null;

function initBrain() {
  try {
  const { SwormBrain } = require('./brain');
  const ctx = {
    sendToPty,
    waitForPty: (id: string) => new Promise((resolve, reject) => {
      pending.set(`create:${id}`, resolve);
      setTimeout(() => { pending.delete(`create:${id}`); reject(new Error('PTY timeout')); }, 10000);
    }),
    getPanes: () => new Promise((resolve) => {
      if (!mainWindow) { resolve([]); return; }
      const channel = `brain:panes-${Date.now()}`;
      ipcMain.once(channel, (_e, panes) => resolve(panes));
      mainWindow.webContents.send('brain:get-panes', channel);
      setTimeout(() => resolve([]), 3000); // fallback
    }),
    log,
  };

  const onStatus = (type: string, detail?: string) => {
    mainWindow?.webContents.send('brain:status', type, detail || '');
    log(`[Brain] Status: ${type}${detail ? ' — ' + detail : ''}`);
  };

  brain = new SwormBrain(ctx, onStatus);
  log('[Sworm] Brain initialized');
  } catch (e) {
    log(`[Sworm] Brain init failed (AI commands disabled): ${e}`);
  }
}

let brainBusy = false;
ipcMain.handle('brain:process', async (_e, text: string) => {
  if (!brain) return { response: '', error: 'Brain not initialized' };
  if (brainBusy) {
    log('[Brain] Busy, dropping: ' + text);
    return { response: '', error: 'Brain is busy processing another command' };
  }
  brainBusy = true;
  try {
    const response = await brain.process(text);
    return { response };
  } catch (e) {
    return { response: '', error: String(e) };
  } finally {
    brainBusy = false;
  }
});

// ─── App Lifecycle ──────────────────────────────────────────

// Single instance lock — if another instance launches, focus the existing window
const gotLock = app.requestSingleInstanceLock();
log(`[Sworm] Single instance lock: ${gotLock}`);
if (!gotLock) {
  log('[Sworm] Another instance running, quitting');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    globalShortcut.unregisterAll();

    startPtyServer();
    createWindow();
    initBrain();
    log('[Sworm] Window created, registering shortcuts...');
    const shortcuts = registerGlobalShortcuts();
    log(`[Sworm] Voice: ${shortcuts}`);
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  ptyProcess?.kill();
  app.quit();
});
