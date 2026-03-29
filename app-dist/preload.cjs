"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Sworm — Electron Preload Script
 * Exposes a safe IPC bridge to the renderer process.
 */
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('sworm', {
    pty: {
        create: (opts) => electron_1.ipcRenderer.invoke('pty:create', opts),
        write: (id, data) => electron_1.ipcRenderer.send('pty:write', id, data),
        resize: (id, cols, rows) => electron_1.ipcRenderer.send('pty:resize', id, cols, rows),
        kill: (id) => electron_1.ipcRenderer.send('pty:kill', id),
        onData: (callback) => {
            electron_1.ipcRenderer.on('pty:data', (_event, id, data) => callback(id, data));
        },
        onExit: (callback) => {
            electron_1.ipcRenderer.on('pty:exit', (_event, id, exitCode) => callback(id, exitCode));
        },
        list: () => electron_1.ipcRenderer.invoke('pty:list'),
    },
    git: {
        worktree: (opts) => electron_1.ipcRenderer.invoke('git:worktree', opts),
    },
    app: {
        launch: (opts) => electron_1.ipcRenderer.invoke('app:launch', opts),
    },
});
//# sourceMappingURL=preload.js.map