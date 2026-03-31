"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Sworm — Electron Main Process
 * Spawns PTY server as child process (system Node) to avoid ABI mismatch.
 */
const electron_1 = require("electron");
const node_child_process_1 = require("node:child_process");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const node_readline_1 = require("node:readline");
const node_fs_1 = require("node:fs");
const node_os_2 = require("node:os");
let mainWindow = null;
let ptyProcess = null;
let paneCounter = 0;
// Pending IPC responses
const pending = new Map();
function startPtyServer() {
    // Use system Node (not Electron's) to run pty-server.cjs
    const nodePath = process.platform === 'win32' ? 'node' : 'node';
    const serverPath = (0, node_path_1.join)(__dirname, '..', 'app', 'pty-server.cjs');
    ptyProcess = (0, node_child_process_1.spawn)(nodePath, [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
    });
    ptyProcess.stderr?.on('data', (data) => {
        console.error('[pty-server]', data.toString());
    });
    // Read JSON messages from pty-server stdout
    const rl = (0, node_readline_1.createInterface)({ input: ptyProcess.stdout });
    rl.on('line', (line) => {
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
        }
        catch {
            // ignore parse errors
        }
    });
    ptyProcess.on('exit', (code) => {
        console.log(`[Sworm] PTY server exited with code ${code}`);
    });
}
function sendToPty(msg) {
    ptyProcess?.stdin?.write(JSON.stringify(msg) + '\n');
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
            preload: (0, node_path_1.join)(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    mainWindow.maximize();
    mainWindow.loadFile((0, node_path_1.join)(__dirname, '..', 'app', 'renderer', 'index.html'));
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
electron_1.ipcMain.handle('pty:create', (_event, opts) => {
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
electron_1.ipcMain.on('pty:write', (_event, id, data) => {
    sendToPty({ type: 'write', id, data });
});
electron_1.ipcMain.on('pty:resize', (_event, id, cols, rows) => {
    sendToPty({ type: 'resize', id, cols, rows });
});
electron_1.ipcMain.on('pty:kill', (_event, id) => {
    sendToPty({ type: 'kill', id });
});
electron_1.ipcMain.handle('pty:list', () => {
    return [];
});
// Launch external applications
electron_1.ipcMain.handle('app:launch', (_event, opts) => {
    try {
        const child = (0, node_child_process_1.spawn)(opts.exe, opts.args || [], { detached: true, stdio: 'ignore' });
        child.unref();
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: String(e) };
    }
});
electron_1.ipcMain.handle('git:worktree', (_event, opts) => {
    const worktreePath = (0, node_path_1.join)(opts.repo, '..', `sworm-${opts.id}-${opts.branch}`);
    try {
        (0, node_child_process_1.execSync)(`git -C "${opts.repo}" worktree add "${worktreePath}" -b ${opts.branch}`, { stdio: 'pipe' });
    }
    catch {
        try {
            (0, node_child_process_1.execSync)(`git -C "${opts.repo}" worktree add "${worktreePath}" ${opts.branch}`, { stdio: 'pipe' });
        }
        catch (e) {
            return { error: String(e) };
        }
    }
    return { path: worktreePath };
});
// ─── Settings IPC ──────────��───────────────────────────
electron_1.ipcMain.handle('settings:read', () => {
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
    }
    catch {
        return {};
    }
});
electron_1.ipcMain.handle('settings:write', (_event, settings) => {
    try {
        const { writeFileSync, mkdirSync } = require('fs');
        const { join } = require('path');
        const { homedir } = require('os');
        const yaml = require('yaml');
        const dir = join(homedir(), '.sworm');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'config.yaml'), yaml.stringify(settings, { indent: 2 }), 'utf-8');
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: String(e) };
    }
});
// ─── Voice Activation ──────────────────────────────────────
let voiceRecording = false;
let voiceProcess = null;
let currentWavPath = null;
const voiceTempDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_2.tmpdir)(), 'sworm-voice-'));
const WHISPER_PATH = (0, node_path_1.join)((0, node_os_1.homedir)(), '.sworm', 'voice', 'whisper-cli.exe');
const MODEL_PATH = (0, node_path_1.join)((0, node_os_1.homedir)(), '.sworm', 'voice', 'models', 'ggml-tiny.en.bin');
let cachedMicName = null;
function getDefaultMic() {
    if (cachedMicName)
        return cachedMicName;
    try {
        const result = (0, node_child_process_1.spawnSync)('ffmpeg', ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
            timeout: 5000,
        });
        const output = result.stderr?.toString() || '';
        const match = output.match(/"([^"]+)"\s*\(audio\)/);
        if (match) {
            cachedMicName = match[1];
            return cachedMicName;
        }
    }
    catch { }
    return 'Microphone';
}
function isWhisperReady() {
    return (0, node_fs_1.existsSync)(WHISPER_PATH) && (0, node_fs_1.existsSync)(MODEL_PATH);
}
function startVoiceRecording() {
    if (voiceRecording)
        return; // Use toggleVoice for toggle behavior
    if (!isWhisperReady()) {
        mainWindow?.webContents.send('voice:status', 'error', 'Whisper not set up. Run: sworm voice setup');
        return;
    }
    voiceRecording = true;
    mainWindow?.webContents.send('voice:status', 'listening', '');
    console.log('[Voice] Recording...');
    const wavPath = (0, node_path_1.join)(voiceTempDir, `voice-${Date.now()}.wav`);
    currentWavPath = wavPath;
    const micName = getDefaultMic();
    voiceProcess = (0, node_child_process_1.spawn)('ffmpeg', [
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
        }
        else {
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
    if (!voiceRecording)
        return;
    console.log('[Voice] Stop recording');
    // Send 'q' to ffmpeg to stop gracefully — this triggers the 'close' handler which transcribes
    if (voiceProcess) {
        try {
            voiceProcess.stdin?.write('q');
        }
        catch { }
        setTimeout(() => {
            try {
                if (voiceProcess && !voiceProcess.killed)
                    voiceProcess.kill();
            }
            catch { }
        }, 1000);
    }
}
/** Toggle: start if idle, stop if recording */
function toggleVoice() {
    if (voiceRecording) {
        stopVoiceRecording();
    }
    else {
        startVoiceRecording();
    }
}
function transcribeAndExecute(wavPath) {
    mainWindow?.webContents.send('voice:status', 'processing', '');
    console.log('[Voice] Transcribing...');
    if (!(0, node_fs_1.existsSync)(wavPath)) {
        mainWindow?.webContents.send('voice:status', 'idle', '');
        return;
    }
    const result = (0, node_child_process_1.spawnSync)(WHISPER_PATH, [
        '-m', MODEL_PATH,
        '-f', wavPath,
        '-l', 'en',
        '--no-timestamps',
    ], { timeout: 15000 });
    try {
        (0, node_fs_1.unlinkSync)(wavPath);
    }
    catch { }
    let text = result.stdout?.toString().trim() || '';
    // Strip whisper artifacts
    text = text.replace(/\[BLANK_AUDIO\]/g, '').replace(/\(.*?\)/g, '').trim();
    console.log('[Voice] Result:', text || '(empty)');
    if (text) {
        mainWindow?.webContents.send('voice:result', text);
    }
    else {
        mainWindow?.webContents.send('voice:status', 'error', 'No speech detected');
        setTimeout(() => mainWindow?.webContents.send('voice:status', 'idle', ''), 2000);
        return;
    }
    mainWindow?.webContents.send('voice:status', 'idle', '');
}
function registerVoiceShortcuts() {
    // Ctrl+F9 = toggle: press to start, press again to stop
    const cf9ok = electron_1.globalShortcut.register('Ctrl+F9', () => {
        console.log('[Voice] Ctrl+F9 toggle');
        toggleVoice();
    });
    console.log('[Voice] Ctrl+F9 toggle:', cf9ok ? 'OK' : 'TAKEN');
    // F9 = hold-to-talk: record while held, stop on release
    // globalShortcut can't detect keyup, so we use before-input-event on the window
    // AND register F9 globally to capture it even when app isn't focused
    let f9Held = false;
    const f9ok = electron_1.globalShortcut.register('F9', () => {
        // Global F9 keydown — start recording if not already
        if (!f9Held) {
            f9Held = true;
            console.log('[Voice] F9 held (start)');
            if (!voiceRecording)
                startVoiceRecording();
        }
    });
    console.log('[Voice] F9 hold-to-talk:', f9ok ? 'OK' : 'TAKEN');
    // Detect F9 keyup via polling — globalShortcut fires repeatedly while held,
    // so we detect "release" when it stops firing for >200ms
    if (f9ok) {
        let lastF9Time = 0;
        const origHandler = electron_1.globalShortcut.isRegistered('F9');
        // Override: track last fire time
        electron_1.globalShortcut.unregister('F9');
        electron_1.globalShortcut.register('F9', () => {
            lastF9Time = Date.now();
            if (!f9Held) {
                f9Held = true;
                console.log('[Voice] F9 held (start)');
                if (!voiceRecording)
                    startVoiceRecording();
            }
        });
        // Poll to detect release (no repeat fires for 250ms = released)
        setInterval(() => {
            if (f9Held && Date.now() - lastF9Time > 250) {
                f9Held = false;
                console.log('[Voice] F9 released (stop)');
                if (voiceRecording)
                    stopVoiceRecording();
            }
        }, 100);
    }
    const label = (f9ok ? 'F9 hold' : '') + (f9ok && cf9ok ? ' | ' : '') + (cf9ok ? 'Ctrl+F9 toggle' : '');
    mainWindow?.webContents.send('voice:shortcut', label || 'none');
    return label;
}
// IPC for voice from renderer
electron_1.ipcMain.on('voice:start', () => startVoiceRecording());
electron_1.ipcMain.on('voice:stop', () => stopVoiceRecording());
// ─── App Lifecycle ──────────────────────────────────────────
electron_1.app.whenReady().then(() => {
    // Remove default menu bar
    electron_1.Menu.setApplicationMenu(null);
    startPtyServer();
    createWindow();
    const shortcuts = registerVoiceShortcuts();
    console.log(`[Sworm] Voice: ${shortcuts}`);
});
electron_1.app.on('will-quit', () => {
    electron_1.globalShortcut.unregisterAll();
});
electron_1.app.on('window-all-closed', () => {
    ptyProcess?.kill();
    electron_1.app.quit();
});
//# sourceMappingURL=main.js.map