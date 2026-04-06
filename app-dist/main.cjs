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
const settings_1 = require("../src/config/settings.cjs");
const brain_tools_1 = require("./brain-tools.cjs");
const LOG_PATH = (0, node_path_1.join)((0, node_os_1.tmpdir)(), 'sworm-debug.log');
function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    try {
        (0, node_fs_1.appendFileSync)(LOG_PATH, line + '\n');
    }
    catch { }
}
log('[Sworm] Main process starting...');
let mainWindow = null;
let ptyProcess = null;
let paneCounter = 0;
let showWindowIds = false;
async function sendWindowIds() {
    if (!mainWindow)
        return;
    const windows = await (0, brain_tools_1.listClaudeWindows)();
    const label = (0, brain_tools_1.formatWindowIdLabel)(windows.map((window) => ({ id: window.hwnd, title: window.title })));
    mainWindow.webContents.send('window:ids', showWindowIds, label);
}
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
    // Load icon from multiple possible locations
    const iconPaths = [
        (0, node_path_1.join)(__dirname, 'sworm-icon.ico'),
        (0, node_path_1.join)(__dirname, '..', 'app', 'sworm-icon.ico'),
        (0, node_path_1.join)(__dirname, '..', 'logos', 'sworm-icon.png'),
    ];
    const iconPath = iconPaths.find(p => (0, node_fs_1.existsSync)(p)) || iconPaths[0];
    const appIcon = electron_1.nativeImage.createFromPath(iconPath);
    mainWindow = new electron_1.BrowserWindow({
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
            preload: (0, node_path_1.join)(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    mainWindow.maximize();
    mainWindow.loadFile((0, node_path_1.join)(__dirname, '..', 'app', 'renderer', 'index.html'));
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
        return (0, settings_1.loadSettings)();
    }
    catch {
        return (0, settings_1.loadSettings)();
    }
});
electron_1.ipcMain.handle('settings:write', (_event, settings) => {
    try {
        (0, settings_1.saveSettings)(settings);
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: String(e) };
    }
});
// ─── Voice (local whisper transcription) ─────────────────
let voiceRecording = false;
let voiceRecordStart = 0;
let voiceProcess = null;
const voiceTempDir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'sworm-voice-'));
const DEFAULT_WHISPER_DIR = (0, node_path_1.join)((0, node_os_1.homedir)(), '.sworm', 'voice');
function getSettings() {
    return (0, settings_1.loadSettings)();
}
function getVoiceConfig() {
    const settings = getSettings();
    const configuredBinary = settings.voice.whisper.binaryPath.trim();
    const configuredModel = settings.voice.whisper.modelPath.trim();
    return {
        whisperDir: DEFAULT_WHISPER_DIR,
        whisperPath: configuredBinary || (0, node_path_1.join)(DEFAULT_WHISPER_DIR, 'whisper-cli.exe'),
        modelPath: configuredModel || (0, node_path_1.join)(DEFAULT_WHISPER_DIR, 'models', 'ggml-tiny.en.bin'),
        sampleRate: settings.voice.whisper.sampleRate,
        recorder: settings.voice.recorder,
        pttTimeout: settings.voice.pttTimeout,
        silenceChunks: settings.voice.silenceChunks,
        pushToTalkHotkey: settings.voice.pushToTalk.hotkey,
    };
}
let cachedMicName = null;
function getDefaultMic() {
    if (cachedMicName)
        return cachedMicName;
    try {
        const result = (0, node_child_process_1.spawnSync)('ffmpeg', ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { timeout: 5000 });
        const output = result.stderr?.toString() || '';
        const match = output.match(/"([^"]+)"\s*\(audio\)/);
        if (match) {
            cachedMicName = match[1];
            return cachedMicName;
        }
        log(`[Voice] No DirectShow mic found. ffmpeg output: ${output.slice(0, 500)}`);
    }
    catch (e) {
        log(`[Voice] Failed to list audio devices: ${e}`);
    }
    return null;
}
function startVoiceRecording() {
    if (voiceRecording)
        return;
    const { whisperPath, modelPath, sampleRate } = getVoiceConfig();
    if (!(0, node_fs_1.existsSync)(whisperPath) || !(0, node_fs_1.existsSync)(modelPath)) {
        mainWindow?.webContents.send('voice:status', 'error', 'Whisper not set up');
        return;
    }
    voiceRecording = true;
    voiceRecordStart = Date.now();
    const wavPath = (0, node_path_1.join)(voiceTempDir, `voice-${Date.now()}.wav`);
    mainWindow?.webContents.send('voice:status', 'listening', '');
    log('[Voice] Recording...');
    const micName = getDefaultMic();
    if (!micName) {
        voiceRecording = false;
        mainWindow?.webContents.send('voice:status', 'error', 'No microphone found');
        return;
    }
    voiceProcess = (0, node_child_process_1.spawn)('ffmpeg', [
        '-f', 'dshow', '-i', `audio=${micName}`,
        '-ar', String(sampleRate), '-ac', '1', '-y', wavPath,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    let ffmpegStderr = '';
    voiceProcess.stderr?.on('data', (chunk) => {
        ffmpegStderr += chunk.toString();
    });
    voiceProcess.on('error', (err) => {
        log(`[Voice] FFmpeg error: ${err.message}`);
        voiceRecording = false;
        mainWindow?.webContents.send('voice:status', 'error', 'Mic capture failed');
    });
    // Store path for stop handler
    voiceProcess._wavPath = wavPath;
    voiceProcess._ffmpegStderr = () => ffmpegStderr;
}
function stopVoiceRecording() {
    if (!voiceRecording || !voiceProcess)
        return;
    voiceRecording = false;
    log('[Voice] Stop recording');
    const proc = voiceProcess;
    const wavPath = proc._wavPath;
    const ffmpegStderr = proc._ffmpegStderr;
    voiceProcess = null;
    try {
        proc.stdin?.write('q');
    }
    catch { }
    mainWindow?.webContents.send('voice:status', 'processing', '');
    proc.on('close', () => {
        void transcribeVoiceRecording(wavPath, ffmpegStderr);
    });
    setTimeout(() => { try {
        if (!proc.killed)
            proc.kill();
    }
    catch { } }, 2000);
}
async function transcribeVoiceRecording(wavPath, ffmpegStderr) {
    if (!(0, node_fs_1.existsSync)(wavPath)) {
        log(`[Voice] No audio recorded. ffmpeg stderr: ${(ffmpegStderr?.() || '').slice(0, 500)}`);
        mainWindow?.webContents.send('voice:status', 'error', 'No audio recorded');
        return;
    }
    const { whisperPath, modelPath, whisperDir } = getVoiceConfig();
    log('[Voice] Transcribing...');
    try {
        const text = await new Promise((resolve, reject) => {
            const proc = (0, node_child_process_1.spawn)(whisperPath, [
                '-m', modelPath, '-f', wavPath, '-l', 'en', '--no-timestamps',
            ], { cwd: whisperDir, stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (chunk) => {
                stdout += chunk.toString();
            });
            proc.stderr?.on('data', (chunk) => {
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
        if (exactHallucinations.has(cleaned.toLowerCase()) || /^\.*$/.test(cleaned))
            cleaned = '';
        log(`[Voice] Result: ${cleaned || '(empty)'}`);
        if (cleaned) {
            mainWindow?.webContents.send('voice:result', cleaned);
        }
        else {
            mainWindow?.webContents.send('voice:status', 'error', 'Empty transcript');
        }
    }
    catch (e) {
        log(`[Voice] Whisper failed: ${e}`);
        mainWindow?.webContents.send('voice:status', 'error', 'Transcription failed');
    }
    finally {
        try {
            (0, node_fs_1.unlinkSync)(wavPath);
        }
        catch { }
    }
}
function toggleVoice() {
    if (voiceRecording)
        stopVoiceRecording();
    else
        startVoiceRecording();
}
// ─── Global Shortcuts ────────────────────────────────────
function tryRegister(combos, handler) {
    for (const combo of combos) {
        const ok = electron_1.globalShortcut.register(combo, handler);
        if (ok) {
            log(`[Shortcut] Registered: ${combo}`);
            return combo;
        }
        log(`[Shortcut] ${combo} TAKEN, trying next...`);
    }
    return null;
}
function registerGlobalShortcuts() {
    // Toggle voice: Ctrl+Alt+V — tap to start listening, tap to stop
    let lastToggle = 0;
    const toggleKey = tryRegister(['Ctrl+Alt+V', 'F9'], () => {
        const now = Date.now();
        if (now - lastToggle < 300)
            return;
        lastToggle = now;
        log('[Voice] Toggle pressed');
        toggleVoice();
    });
    // Push-to-talk uses F10 because holding Alt can retrigger global shortcuts on Windows.
    let pttKey = null;
    let lastPttToggle = 0;
    for (const combo of ['F10']) {
        const ok = electron_1.globalShortcut.register(combo, () => {
            const now = Date.now();
            if (now - lastPttToggle < 300)
                return;
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
    const windowKey = tryRegister(['Ctrl+`', 'F8'], () => {
        if (!mainWindow)
            return;
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        }
        else {
            mainWindow.show();
            mainWindow.focus();
        }
    });
    const showIdsKey = tryRegister(['Ctrl+Alt+I', 'F7'], () => {
        showWindowIds = !showWindowIds;
        log(`[Window] toggle-window-ids ${showWindowIds ? 'on' : 'off'}`);
        void sendWindowIds();
    });
    const parts = [];
    if (pttKey)
        parts.push(`${pttKey} push-to-talk`);
    if (toggleKey)
        parts.push(`${toggleKey} toggle voice`);
    if (windowKey)
        parts.push(`${windowKey} toggle window`);
    if (showIdsKey)
        parts.push(`${showIdsKey} show window ids`);
    const label = parts.join(' | ') || 'no shortcuts available';
    currentShortcutLabel = label;
    mainWindow?.webContents.send('voice:shortcut', label);
    log(`[Sworm] Global shortcuts: ${label}`);
    return label;
}
let currentShortcutLabel = '';
electron_1.ipcMain.on('voice:start', () => startVoiceRecording());
electron_1.ipcMain.on('voice:stop', () => stopVoiceRecording());
electron_1.ipcMain.on('voice:ready', () => {
    if (currentShortcutLabel)
        mainWindow?.webContents.send('voice:shortcut', currentShortcutLabel);
});
// ─── Brain (LLM command interpretation) ──────────────────
let brain = null;
function initBrain() {
    try {
        const { SwormBrain } = require('./brain.cjs');
        const ctx = {
            sendToPty,
            waitForPty: (id) => new Promise((resolve, reject) => {
                pending.set(`create:${id}`, resolve);
                setTimeout(() => { pending.delete(`create:${id}`); reject(new Error('PTY timeout')); }, 10000);
            }),
            createPaneInRenderer: (opts) => {
                mainWindow?.webContents.send('brain:create-pane', opts);
            },
            getPanes: () => new Promise((resolve) => {
                if (!mainWindow) {
                    resolve([]);
                    return;
                }
                const channel = `brain:panes-${Date.now()}`;
                electron_1.ipcMain.once(channel, (_e, panes) => resolve(panes));
                mainWindow.webContents.send('brain:get-panes', channel);
                setTimeout(() => resolve([]), 3000); // fallback
            }),
            log,
        };
        const onStatus = (type, detail) => {
            mainWindow?.webContents.send('brain:status', type, detail || '');
            log(`[Brain] Status: ${type}${detail ? ' — ' + detail : ''}`);
        };
        brain = new SwormBrain(ctx, onStatus);
        log('[Sworm] Brain initialized');
    }
    catch (e) {
        log(`[Sworm] Brain init failed (AI commands disabled): ${e}`);
    }
}
let brainBusy = false;
electron_1.ipcMain.on('window:refresh-ids', () => {
    void sendWindowIds();
});
electron_1.ipcMain.handle('brain:process', async (_e, text) => {
    if (!brain)
        return { response: '', error: 'Brain not initialized' };
    if (brainBusy) {
        log('[Brain] Busy, dropping: ' + text);
        return { response: '', error: 'Brain is busy processing another command' };
    }
    brainBusy = true;
    try {
        const response = await brain.process(text);
        return { response };
    }
    catch (e) {
        return { response: '', error: String(e) };
    }
    finally {
        brainBusy = false;
    }
});
// ─── App Lifecycle ──────────────────────────────────────────
// Single instance lock — if another instance launches, focus the existing window
const gotLock = electron_1.app.requestSingleInstanceLock();
log(`[Sworm] Single instance lock: ${gotLock}`);
if (!gotLock) {
    log('[Sworm] Another instance running, quitting');
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            if (!mainWindow.isVisible())
                mainWindow.show();
            mainWindow.focus();
        }
    });
    electron_1.app.whenReady().then(() => {
        electron_1.Menu.setApplicationMenu(null);
        electron_1.globalShortcut.unregisterAll();
        startPtyServer();
        createWindow();
        initBrain();
        log('[Sworm] Window created, registering shortcuts...');
        const shortcuts = registerGlobalShortcuts();
        log(`[Sworm] Voice: ${shortcuts}`);
    });
}
electron_1.app.on('will-quit', () => {
    electron_1.globalShortcut.unregisterAll();
});
electron_1.app.on('window-all-closed', () => {
    ptyProcess?.kill();
    electron_1.app.quit();
});
//# sourceMappingURL=main.js.map