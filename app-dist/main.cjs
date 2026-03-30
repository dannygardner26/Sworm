"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Sworm — Electron Main Process
 * Spawns PTY server as child process (system Node) to avoid ABI mismatch.
 */
const electron_1 = require("electron");
const node_child_process_1 = require("node:child_process");
const node_path_1 = require("node:path");
const node_readline_1 = require("node:readline");
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
        fullscreen: true,
        frame: false,
        backgroundColor: '#0a0a0a',
        webPreferences: {
            preload: (0, node_path_1.join)(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
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
// ─── App Lifecycle ──────────────────────────────────────────
electron_1.app.whenReady().then(() => {
    startPtyServer();
    createWindow();
});
electron_1.app.on('window-all-closed', () => {
    ptyProcess?.kill();
    electron_1.app.quit();
});
//# sourceMappingURL=main.js.map