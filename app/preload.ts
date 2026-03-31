/**
 * Sworm — Electron Preload Script
 * Exposes a safe IPC bridge to the renderer process.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface SwormAPI {
  pty: {
    create(opts: { id?: string; cmd?: string; cwd?: string; cols?: number; rows?: number }): Promise<{ id: string; pid: number }>;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    kill(id: string): void;
    onData(callback: (id: string, data: string) => void): void;
    onExit(callback: (id: string, exitCode: number) => void): void;
    list(): Promise<string[]>;
  };
  git: {
    worktree(opts: { repo: string; branch: string; id: string }): Promise<{ path?: string; error?: string }>;
  };
  app: {
    launch(opts: { exe: string; args?: string[] }): Promise<{ ok: boolean; error?: string }>;
  };
  settings: {
    read(): Promise<any>;
    write(settings: any): Promise<{ ok: boolean; error?: string }>;
  };
  voice: {
    start(): void;
    stop(): void;
    onStatus(callback: (status: string, message: string) => void): void;
    onResult(callback: (text: string) => void): void;
    onShortcut(callback: (shortcut: string) => void): void;
  };
}

contextBridge.exposeInMainWorld('sworm', {
  pty: {
    create: (opts: any) => ipcRenderer.invoke('pty:create', opts),
    write: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.send('pty:kill', id),
    onData: (callback: (id: string, data: string) => void) => {
      ipcRenderer.on('pty:data', (_event, id, data) => callback(id, data));
    },
    onExit: (callback: (id: string, exitCode: number) => void) => {
      ipcRenderer.on('pty:exit', (_event, id, exitCode) => callback(id, exitCode));
    },
    list: () => ipcRenderer.invoke('pty:list'),
  },
  git: {
    worktree: (opts: any) => ipcRenderer.invoke('git:worktree', opts),
  },
  app: {
    launch: (opts: any) => ipcRenderer.invoke('app:launch', opts),
  },
  settings: {
    read: () => ipcRenderer.invoke('settings:read'),
    write: (settings: any) => ipcRenderer.invoke('settings:write', settings),
  },
  voice: {
    start: () => ipcRenderer.send('voice:start'),
    stop: () => ipcRenderer.send('voice:stop'),
    onStatus: (callback: (status: string, message: string) => void) => {
      ipcRenderer.on('voice:status', (_event, status, message) => callback(status, message));
    },
    onResult: (callback: (text: string) => void) => {
      ipcRenderer.on('voice:result', (_event, text) => callback(text));
    },
    onShortcut: (callback: (shortcut: string) => void) => {
      ipcRenderer.on('voice:shortcut', (_event, shortcut) => callback(shortcut));
    },
  },
} satisfies SwormAPI);
