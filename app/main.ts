/**
 * Sworm — Electron Main Process
 * Spawns PTY server as child process (system Node) to avoid ABI mismatch.
 */
import { app, BrowserWindow, ipcMain, globalShortcut, Menu, nativeImage } from 'electron';
import { spawn, execSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { existsSync, unlinkSync, mkdtempSync, appendFileSync } from 'node:fs';
import { loadSettings, saveSettings, type SwormSettings } from '../src/config/settings';
import { formatWindowIdLabel, listClaudeWindows } from './brain-tools';

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
let showWindowIds = false;

async function sendWindowIds() {
  if (!mainWindow) return;
  const windows = await listClaudeWindows();
  const label = formatWindowIdLabel(windows.map((window) => ({ id: window.hwnd, title: window.title })));
  mainWindow.webContents.send('window:ids', showWindowIds, label);
}

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
  mainWindow.webContents.on('did-finish-load', () => { void sendWindowIds(); });

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
    return loadSettings();
  } catch {
    return loadSettings();
  }
});

ipcMain.handle('settings:write', (_event, settings: SwormSettings) => {
  try {
    saveSettings(settings);
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
const DEFAULT_WHISPER_DIR = join(homedir(), '.sworm', 'voice');

function getSettings(): SwormSettings {
  return loadSettings();
}

function getVoiceConfig() {
  const settings = getSettings();
  const configuredBinary = settings.voice.whisper.binaryPath.trim();
  const configuredModel = settings.voice.whisper.modelPath.trim();
  return {
    whisperDir: DEFAULT_WHISPER_DIR,
    whisperPath: configuredBinary || join(DEFAULT_WHISPER_DIR, 'whisper-cli.exe'),
    modelPath: configuredModel || join(DEFAULT_WHISPER_DIR, 'models', 'ggml-tiny.en.bin'),
    sampleRate: settings.voice.whisper.sampleRate,
    recorder: settings.voice.recorder,
    pttTimeout: settings.voice.pttTimeout,
    silenceChunks: settings.voice.silenceChunks,
    pushToTalkHotkey: settings.voice.pushToTalk.hotkey,
  };
}

let cachedMicName: string | null = null;
function getDefaultMic(): string | null {
  if (cachedMicName) return cachedMicName;
  try {
    const result = spawnSync('ffmpeg', ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { timeout: 5000 });
    const output = result.stderr?.toString() || '';
    const match = output.match(/"([^"]+)"\s*\(audio\)/);
    if (match) { cachedMicName = match[1]; return cachedMicName; }
    log(`[Voice] No DirectShow mic found. ffmpeg output: ${output.slice(0, 500)}`);
  } catch (e) {
    log(`[Voice] Failed to list audio devices: ${e}`);
  }
  return null;
}

function startVoiceRecording() {
  if (voiceRecording) return;
  const { whisperPath, modelPath, sampleRate } = getVoiceConfig();
  if (!existsSync(whisperPath) || !existsSync(modelPath)) {
    mainWindow?.webContents.send('voice:status', 'error', 'Whisper not set up');
    return;
  }

  voiceRecording = true;
  voiceRecordStart = Date.now();
  const wavPath = join(voiceTempDir, `voice-${Date.now()}.wav`);
  mainWindow?.webContents.send('voice:status', 'listening', '');
  log('[Voice] Recording...');

  const micName = getDefaultMic();
  if (!micName) {
    voiceRecording = false;
    mainWindow?.webContents.send('voice:status', 'error', 'No microphone found');
    return;
  }

  voiceProcess = spawn('ffmpeg', [
    '-f', 'dshow', '-i', `audio=${micName}`,
    '-ar', String(sampleRate), '-ac', '1', '-y', wavPath,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let ffmpegStderr = '';
  voiceProcess.stderr?.on('data', (chunk: Buffer) => {
    ffmpegStderr += chunk.toString();
  });

  voiceProcess.on('error', (err) => {
    log(`[Voice] FFmpeg error: ${err.message}`);
    voiceRecording = false;
    mainWindow?.webContents.send('voice:status', 'error', 'Mic capture failed');
  });

  // Store path for stop handler
  (voiceProcess as any)._wavPath = wavPath;
  (voiceProcess as any)._ffmpegStderr = () => ffmpegStderr;
}

function stopVoiceRecording() {
  if (!voiceRecording || !voiceProcess) return;
  voiceRecording = false;
  log('[Voice] Stop recording');

  const proc = voiceProcess;
  const wavPath = (proc as any)._wavPath;
  const ffmpegStderr = (proc as any)._ffmpegStderr as (() => string) | undefined;
  voiceProcess = null;

  try { proc.stdin?.write('q'); } catch {}

  mainWindow?.webContents.send('voice:status', 'processing', '');

  proc.on('close', () => {
    void transcribeVoiceRecording(wavPath, ffmpegStderr);
  });

  setTimeout(() => { try { if (!proc.killed) proc.kill(); } catch {} }, 2000);
}

async function transcribeVoiceRecording(wavPath: string, ffmpegStderr?: () => string) {
  if (!existsSync(wavPath)) {
    log(`[Voice] No audio recorded. ffmpeg stderr: ${(ffmpegStderr?.() || '').slice(0, 500)}`);
    mainWindow?.webContents.send('voice:status', 'error', 'No audio recorded');
    return;
  }

  const { whisperPath, modelPath, whisperDir } = getVoiceConfig();
  log('[Voice] Transcribing...');

  try {
    const text = await new Promise<string>((resolve, reject) => {
      const proc = spawn(whisperPath, [
        '-m', modelPath, '-f', wavPath, '-l', 'en', '--no-timestamps',
      ], { cwd: whisperDir, stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(new Error(stderr.trim() || `whisper exited with code ${code}`));
      });
    });

    let cleaned = text.trim();
    cleaned = cleaned.replace(/\[BLANK_AUDIO\]/g, '').replace(/\(.*?\)/g, '').trim();
    const exactHallucinations = new Set(['thank', 'thanks', 'subscribe', 'like', 'comment', 'share', 'you', 'bye', 'see you', 'the end']);
    if (exactHallucinations.has(cleaned.toLowerCase()) || /^\.*$/.test(cleaned)) cleaned = '';
    log(`[Voice] Result: ${cleaned || '(empty)'}`);

    if (cleaned) {
      mainWindow?.webContents.send('voice:result', cleaned);
    } else {
      mainWindow?.webContents.send('voice:status', 'error', 'Empty transcript');
    }
  } catch (e) {
    log(`[Voice] Whisper failed: ${e}`);
    mainWindow?.webContents.send('voice:status', 'error', 'Transcription failed');
  } finally {
    try { unlinkSync(wavPath); } catch {}
  }
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

  // Push-to-talk uses F10 because holding Alt can retrigger global shortcuts on Windows.
  let pttKey: string | null = null;
  let lastPttToggle = 0;

  for (const combo of ['F10']) {
    const ok = globalShortcut.register(combo, () => {
      const now = Date.now();
      if (now - lastPttToggle < 300) return;
      lastPttToggle = now;
      log('[Voice] PTT pressed');
      toggleVoice();
    });
    if (ok) {
      pttKey = combo;
      log(`[Shortcut] Registered PTT: ${combo}`);
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

  const showIdsKey = tryRegister(['Ctrl+Alt+I', 'F7'], () => {
    showWindowIds = !showWindowIds;
    log(`[Window] toggle-window-ids ${showWindowIds ? 'on' : 'off'}`);
    void sendWindowIds();
  });

  const parts: string[] = [];
  if (pttKey) parts.push(`${pttKey} push-to-talk`);
  if (toggleKey) parts.push(`${toggleKey} toggle voice`);
  if (windowKey) parts.push(`${windowKey} toggle window`);
  if (showIdsKey) parts.push(`${showIdsKey} show window ids`);
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
    createPaneInRenderer: (opts: { id: string; name: string; cmd?: string }) => {
      mainWindow?.webContents.send('brain:create-pane', opts);
    },
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
ipcMain.on('window:refresh-ids', () => {
  void sendWindowIds();
});

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
