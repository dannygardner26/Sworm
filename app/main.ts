/**
 * Sworm — Electron Main Process
 * Spawns PTY server as child process (system Node) to avoid ABI mismatch.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, execSync } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

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
    fullscreen: true,
    frame: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

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

// ─── App Lifecycle ──────────────────────────────────────────

app.whenReady().then(() => {
  startPtyServer();
  createWindow();
});

app.on('window-all-closed', () => {
  ptyProcess?.kill();
  app.quit();
});
