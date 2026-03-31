/**
 * Voice overlay — shows a small always-on-top window when listening.
 * Uses Win32 APIs via koffi for a lightweight native overlay.
 */
import koffi from 'koffi';

const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');

// Win32 constants
const WS_POPUP = 0x80000000;
const WS_VISIBLE = 0x10000000;
const WS_EX_TOPMOST = 0x00000008;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_LAYERED = 0x00080000;
const WS_EX_TRANSPARENT = 0x00000020;
const WS_EX_NOACTIVATE = 0x08000000;
const LWA_ALPHA = 0x02;
const SW_SHOW = 5;
const SW_HIDE = 0;
const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;

// Win32 functions
const CreateWindowExW = user32.func(
  'long CreateWindowExW(uint dwExStyle, string16 lpClassName, string16 lpWindowName, uint dwStyle, int x, int y, int w, int h, long hWndParent, long hMenu, long hInstance, long lpParam)',
);
const ShowWindow = user32.func('bool ShowWindow(long hWnd, int nCmdShow)');
const DestroyWindow = user32.func('bool DestroyWindow(long hWnd)');
const SetLayeredWindowAttributes = user32.func(
  'bool SetLayeredWindowAttributes(long hwnd, uint crKey, uint8 bAlpha, uint dwFlags)',
);
const GetSystemMetrics = user32.func('int GetSystemMetrics(int nIndex)');
const SetWindowPos = user32.func(
  'bool SetWindowPos(long hWnd, long hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)',
);
const GetDC = user32.func('long GetDC(long hWnd)');
const ReleaseDC = user32.func('int ReleaseDC(long hWnd, long hDC)');

// GDI functions
const CreateSolidBrush = gdi32.func('long CreateSolidBrush(uint color)');
const DeleteObject = gdi32.func('bool DeleteObject(long hObject)');

const HWND_TOPMOST = -1;
const SWP_NOMOVE = 0x0002;
const SWP_NOSIZE = 0x0001;
const SWP_NOACTIVATE = 0x0010;

let overlayHwnd: number | null = null;

/**
 * Show a small "Listening..." overlay at the top-center of the screen.
 */
export function showListeningOverlay(): void {
  if (overlayHwnd) return; // Already showing

  try {
    const screenW = GetSystemMetrics(SM_CXSCREEN) as number;

    const width = 200;
    const height = 40;
    const x = Math.round((screenW - width) / 2);
    const y = 20;

    // Create a layered popup window
    const hwnd = CreateWindowExW(
      WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_LAYERED | WS_EX_NOACTIVATE,
      'Static', // Use built-in Static window class
      '  Listening...',
      WS_POPUP | WS_VISIBLE,
      x,
      y,
      width,
      height,
      0,
      0,
      0,
      0,
    ) as number;

    if (!hwnd) return;

    // Set transparency (220/255 ≈ 86% opaque)
    SetLayeredWindowAttributes(hwnd, 0, 220, LWA_ALPHA);

    // Keep on top
    SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

    overlayHwnd = hwnd;
  } catch {
    // Overlay creation failed — not critical
  }
}

/**
 * Hide the listening overlay.
 */
export function hideListeningOverlay(): void {
  if (!overlayHwnd) return;

  try {
    DestroyWindow(overlayHwnd);
  } catch {
    // ignore
  }
  overlayHwnd = null;
}

/**
 * Check if overlay is currently visible.
 */
export function isOverlayVisible(): boolean {
  return overlayHwnd !== null;
}
