/**
 * Platform abstraction factory.
 * Currently supports Windows only; future OS support can be added here.
 */
import type { PlatformAPI } from './types.js';
import * as monitor from './windows/monitor.js';
import * as window from './windows/window.js';
import * as proc from './windows/process.js';

export function createPlatform(): PlatformAPI {
  return {
    monitors: {
      getAll: monitor.getAll,
      getPrimary: monitor.getPrimary,
    },
    windows: {
      move: window.move,
      resize: window.resize,
      focus: window.focus,
      minimize: window.minimize,
      maximize: window.maximize,
      restore: window.restore,
      close: window.close,
      findByTitle: window.findByTitle,
      findByProcess: window.findByProcess,
      getRect: window.getRect,
      getTitle: window.getTitle,
      sendToBack: window.sendToBack,
      setZOrder: window.setZOrder,
      setExStyle: window.setExStyle,
      setTitle: window.setTitle,
    },
    processes: {
      spawn: proc.spawn,
      findByName: proc.findByName,
    },
  };
}

export type { PlatformAPI, MonitorInfo, Rect, SpawnOpts, SpawnedProcess, ProcessInfo } from './types.js';
