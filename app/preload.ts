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
} satisfies SwormAPI);
