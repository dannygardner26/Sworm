/**
 * Desktop-parent technique for making windows act like wallpaper.
 * Uses the same WorkerW approach as Wallpaper Engine.
 */
import koffi from 'koffi';

const user32 = koffi.load('user32.dll');

// Bind Win32 functions
const FindWindowW = user32.func('long FindWindowW(str16 lpClassName, str16 lpWindowName)');
const FindWindowExW = user32.func(
  'long FindWindowExW(long hWndParent, long hWndChildAfter, str16 lpszClass, str16 lpszWindow)',
);
const SendMessageTimeoutW = user32.func(
  'long SendMessageTimeoutW(long hWnd, uint Msg, ulong wParam, long lParam, uint fuFlags, uint uTimeout, _Out_ ulong *lpdwResult)',
);
const SetParent = user32.func('long SetParent(long hWndChild, long hWndNewParent)');
const GetWindowLongW = user32.func('long GetWindowLongW(long hWnd, int nIndex)');
const SetWindowLongW = user32.func('long SetWindowLongW(long hWnd, int nIndex, long dwNewLong)');

const SMTO_NORMAL = 0x0000;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_NOACTIVATE = 0x08000000;

/**
 * Find the WorkerW window that sits behind the desktop icons.
 * This is the target parent for wallpaper-mode windows.
 */
export function findWorkerW(): number {
  // Step 1: Find Progman
  const progman = FindWindowW('Progman', null);
  if (!progman) {
    throw new Error('Could not find Progman window');
  }

  // Step 2: Send the magic message to spawn WorkerW
  const result: number[] = [0];
  SendMessageTimeoutW(progman, 0x052c, 0, 0, SMTO_NORMAL, 1000, result);

  // Step 3: Enumerate WorkerW children to find the one with SHELLDLL_DefView
  let workerW = 0;
  let current = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    current = FindWindowExW(0, current, 'WorkerW', null);
    if (!current) break;

    // Check if this WorkerW has a SHELLDLL_DefView child
    const defView = FindWindowExW(current, 0, 'SHELLDLL_DefView', null);
    if (defView) {
      // The NEXT WorkerW after this one is our target
      workerW = FindWindowExW(0, current, 'WorkerW', null);
      break;
    }
  }

  if (!workerW) {
    throw new Error('Could not find target WorkerW window');
  }

  return workerW;
}

/**
 * Parent a window to the desktop WorkerW, making it appear behind icons.
 */
export function parentToDesktop(hwnd: number): void {
  const workerW = findWorkerW();
  SetParent(hwnd, workerW);
}

/**
 * Apply wallpaper extended styles (tool window + no activate).
 */
export function setWallpaperStyle(hwnd: number): void {
  const style = GetWindowLongW(hwnd, GWL_EXSTYLE);
  const newStyle = style | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
  SetWindowLongW(hwnd, GWL_EXSTYLE, newStyle);
}

/**
 * Remove wallpaper styles and un-parent from desktop.
 */
export function removeWallpaperStyle(hwnd: number): void {
  const style = GetWindowLongW(hwnd, GWL_EXSTYLE);
  const newStyle = style & ~(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
  SetWindowLongW(hwnd, GWL_EXSTYLE, newStyle);
  SetParent(hwnd, 0);
}
