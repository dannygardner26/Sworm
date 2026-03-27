/**
 * Cross-platform type definitions for the Sworm platform abstraction layer.
 * All OS-specific implementations must conform to these interfaces.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MonitorInfo {
  id: string;
  name: string;
  bounds: Rect;
  workArea: Rect;
  scaleFactor: number;
  primary: boolean;
}

export interface SpawnOpts {
  cwd?: string;
  env?: Record<string, string>;
  shell?: string | boolean;
  detached?: boolean;
}

export interface SpawnedProcess {
  pid: number;
  kill(): void;
}

export interface ProcessInfo {
  pid: number;
  name: string;
}

export interface PlatformAPI {
  monitors: {
    getAll(): Promise<MonitorInfo[]>;
    getPrimary(): Promise<MonitorInfo>;
  };
  windows: {
    move(hwnd: number, rect: Rect): Promise<void>;
    resize(hwnd: number, width: number, height: number): Promise<void>;
    focus(hwnd: number): Promise<void>;
    minimize(hwnd: number): Promise<void>;
    maximize(hwnd: number): Promise<void>;
    restore(hwnd: number): Promise<void>;
    close(hwnd: number): Promise<void>;
    findByTitle(pattern: string | RegExp): Promise<number[]>;
    findByProcess(pid: number): Promise<number[]>;
    getRect(hwnd: number): Promise<Rect>;
    getTitle(hwnd: number): Promise<string>;
  };
  processes: {
    spawn(command: string, args: string[], opts?: SpawnOpts): Promise<SpawnedProcess>;
    findByName(name: string): Promise<ProcessInfo[]>;
  };
}
