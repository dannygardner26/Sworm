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
    settings: {
        read: () => electron_1.ipcRenderer.invoke('settings:read'),
        write: (settings) => electron_1.ipcRenderer.invoke('settings:write', settings),
    },
    voice: {
        ready: () => electron_1.ipcRenderer.send('voice:ready'),
        start: () => electron_1.ipcRenderer.send('voice:start'),
        stop: () => electron_1.ipcRenderer.send('voice:stop'),
        onStatus: (callback) => {
            electron_1.ipcRenderer.on('voice:status', (_event, status, message) => callback(status, message));
        },
        onResult: (callback) => {
            electron_1.ipcRenderer.on('voice:result', (_event, text) => callback(text));
        },
        onShortcut: (callback) => {
            electron_1.ipcRenderer.on('voice:shortcut', (_event, shortcut) => callback(shortcut));
        },
    },
    brain: {
        process: (text) => electron_1.ipcRenderer.invoke('brain:process', text),
        onStatus: (callback) => {
            electron_1.ipcRenderer.on('brain:status', (_event, type, detail) => callback(type, detail));
        },
        onGetPanes: (callback) => {
            electron_1.ipcRenderer.on('brain:get-panes', (_event, channel) => callback(channel));
        },
        replyPanes: (channel, panes) => {
            electron_1.ipcRenderer.send(channel, panes);
        },
        onCreatePane: (callback) => {
            electron_1.ipcRenderer.on('brain:create-pane', (_event, opts) => callback(opts));
        },
    },
    windowIds: {
        onWindowIds: (callback) => {
            electron_1.ipcRenderer.on('window:ids', (_event, visible, label) => callback(visible, label));
        },
    },
});
//# sourceMappingURL=preload.js.map