/**
 * Win32 window management via koffi.
 * Implements PlatformAPI.windows interface.
 */
import koffi from 'koffi';
import type { Rect } from '../types.js';

// ---------------------------------------------------------------------------
// Load DLLs
// ---------------------------------------------------------------------------
const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------
const RECT = koffi.struct('WRECT', {
  left: 'long',
  top: 'long',
  right: 'long',
  bottom: 'long',
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SW_RESTORE = 9;
const SW_MINIMIZE = 6;
const SW_MAXIMIZE = 3;
const WM_CLOSE = 0x0010;
const SWP_NOZORDER = 0x0004;
const SWP_SHOWWINDOW = 0x0040;
const SWP_NOMOVE = 0x0002;
const HWND_TOP = 0;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;

// ---------------------------------------------------------------------------
// Win32 function bindings
// ---------------------------------------------------------------------------
const SetWindowPos = user32.func(
  'bool SetWindowPos(long hwnd, long hWndInsertAfter, int x, int y, int cx, int cy, uint flags)',
);
const ShowWindow = user32.func('bool ShowWindow(long hwnd, int nCmdShow)');
const SetForegroundWindow = user32.func('bool SetForegroundWindow(long hwnd)');
const IsWindowVisible = user32.func('bool IsWindowVisible(long hwnd)');
const IsIconic = user32.func('bool IsIconic(long hwnd)');
const PostMessageW = user32.func('bool PostMessageW(long hwnd, uint msg, long wParam, long lParam)');
const GetWindowTextLengthW = user32.func('int GetWindowTextLengthW(long hwnd)');
const GetWindowTextW = user32.func('int GetWindowTextW(long hwnd, _Out_ uint16 *lpString, int nMaxCount)');
const GetWindowThreadProcessId = user32.func('uint GetWindowThreadProcessId(long hwnd, _Out_ uint *lpdwProcessId)');
const GetWindowRect = user32.func('bool GetWindowRect(long hwnd, _Out_ WRECT *lpRect)');

const EnumWindowsProc = koffi.proto('bool EnumWindowsProc(long hwnd, long lParam)');
const EnumWindows = user32.func('bool EnumWindows(EnumWindowsProc *cb, long lParam)');

const DwmGetWindowAttribute = dwmapi.func(
  'long DwmGetWindowAttribute(long hwnd, uint dwAttribute, _Out_ WRECT *pvAttribute, uint cbAttribute)',
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getWindowTitle(hwnd: number): string {
  const len = GetWindowTextLengthW(hwnd);
  if (len <= 0) return '';
  const buf = new Uint16Array(len + 1);
  GetWindowTextW(hwnd, buf, len + 1);
  return String.fromCharCode(...buf.slice(0, len));
}

function enumVisibleWindows(): { hwnd: number; title: string }[] {
  const results: { hwnd: number; title: string }[] = [];
  const callback = (hwnd: number, _lParam: number): boolean => {
    if (!IsWindowVisible(hwnd)) return true;
    const title = getWindowTitle(hwnd);
    if (title) {
      results.push({ hwnd, title });
    }
    return true;
  };
  const cb = koffi.register(callback, koffi.pointer(EnumWindowsProc));
  try {
    EnumWindows(cb, 0);
  } finally {
    koffi.unregister(cb);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Public API — PlatformAPI.windows
// ---------------------------------------------------------------------------

export async function move(hwnd: number, rect: Rect): Promise<void> {
  if (IsIconic(hwnd)) {
    ShowWindow(hwnd, SW_RESTORE);
  }
  SetWindowPos(hwnd, HWND_TOP, rect.x, rect.y, rect.width, rect.height, SWP_NOZORDER | SWP_SHOWWINDOW);
}

export async function resize(hwnd: number, width: number, height: number): Promise<void> {
  SetWindowPos(hwnd, HWND_TOP, 0, 0, width, height, SWP_NOMOVE | SWP_NOZORDER);
}

export async function focus(hwnd: number): Promise<void> {
  ShowWindow(hwnd, SW_RESTORE);
  SetForegroundWindow(hwnd);
}

export async function minimize(hwnd: number): Promise<void> {
  ShowWindow(hwnd, SW_MINIMIZE);
}

export async function maximize(hwnd: number): Promise<void> {
  ShowWindow(hwnd, SW_MAXIMIZE);
}

export async function restore(hwnd: number): Promise<void> {
  ShowWindow(hwnd, SW_RESTORE);
}

export async function close(hwnd: number): Promise<void> {
  PostMessageW(hwnd, WM_CLOSE, 0, 0);
}

export async function findByTitle(pattern: string | RegExp): Promise<number[]> {
  const windows = enumVisibleWindows();
  return windows
    .filter((w) => {
      if (typeof pattern === 'string') {
        return w.title.includes(pattern);
      }
      return pattern.test(w.title);
    })
    .map((w) => w.hwnd);
}

export async function findByProcess(pid: number): Promise<number[]> {
  const results: number[] = [];
  const callback = (hwnd: number, _lParam: number): boolean => {
    if (!IsWindowVisible(hwnd)) return true;
    const procId: number[] = [0];
    GetWindowThreadProcessId(hwnd, procId);
    if (procId[0] === pid) {
      results.push(hwnd);
    }
    return true;
  };
  const cb = koffi.register(callback, koffi.pointer(EnumWindowsProc));
  try {
    EnumWindows(cb, 0);
  } finally {
    koffi.unregister(cb);
  }
  return results;
}

export async function getRect(hwnd: number): Promise<Rect> {
  const rect = { left: 0, top: 0, right: 0, bottom: 0 };
  const hr = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, koffi.sizeof(RECT));
  if (hr !== 0) {
    // Fallback to GetWindowRect
    if (!GetWindowRect(hwnd, rect)) {
      throw new Error(`Failed to get window rect for hwnd ${hwnd}`);
    }
  }
  return {
    x: rect.left,
    y: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  };
}

export async function getTitle(hwnd: number): Promise<string> {
  return getWindowTitle(hwnd);
}
