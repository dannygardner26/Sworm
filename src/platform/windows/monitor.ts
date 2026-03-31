/**
 * Win32 monitor detection via koffi.
 * Uses EnumDisplayMonitors + GetMonitorInfoW + GetDpiForMonitor.
 */
import koffi from 'koffi';
import type { MonitorInfo, Rect } from '../types.js';

// ---------------------------------------------------------------------------
// Load DLLs
// ---------------------------------------------------------------------------
const user32 = koffi.load('user32.dll');
const shcore = koffi.load('shcore.dll');

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------
const RECT = koffi.struct('RECT', {
  left: 'long',
  top: 'long',
  right: 'long',
  bottom: 'long',
});

const MONITORINFOEXW = koffi.struct('MONITORINFOEXW', {
  cbSize: 'uint32',
  rcMonitor: RECT,
  rcWork: RECT,
  dwFlags: 'uint32',
  szDevice: koffi.array('uint16', 32),
});

// ---------------------------------------------------------------------------
// Win32 function bindings
// ---------------------------------------------------------------------------
const EnumDisplayMonitorsProc = koffi.proto(
  'bool EnumDisplayMonitorsProc(long hMonitor, long hdc, long lprcClip, long lParam)',
);
const EnumDisplayMonitors = user32.func(
  'bool EnumDisplayMonitors(long hdc, long lprcClip, EnumDisplayMonitorsProc *cb, long lParam)',
);
const GetMonitorInfoW = user32.func(
  'bool GetMonitorInfoW(long hMonitor, _Inout_ MONITORINFOEXW *lpmi)',
);
const GetDpiForMonitor = shcore.func(
  'long GetDpiForMonitor(long hMonitor, int dpiType, _Out_ uint *dpiX, _Out_ uint *dpiY)',
);

// ---------------------------------------------------------------------------
// DPI awareness — best-effort
// ---------------------------------------------------------------------------
try {
  const SetProcessDpiAwarenessContext = user32.func(
    'bool SetProcessDpiAwarenessContext(long value)',
  );
  // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 == -4
  SetProcessDpiAwarenessContext(-4);
} catch {
  // Older Windows versions may not support this — fall through silently.
  console.warn('SetProcessDpiAwarenessContext not available; DPI values may be inaccurate.');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function rectFromWin32(r: { left: number; top: number; right: number; bottom: number }): Rect {
  return {
    x: r.left,
    y: r.top,
    width: r.right - r.left,
    height: r.bottom - r.top,
  };
}

function wcharToString(arr: number[]): string {
  const end = arr.indexOf(0);
  const codes = end === -1 ? arr : arr.slice(0, end);
  return String.fromCharCode(...codes);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
const MONITORINFOF_PRIMARY = 1;
const DEFAULT_DPI = 96;

export function getAll(): Promise<MonitorInfo[]> {
  return new Promise((resolve, reject) => {
    const monitors: MonitorInfo[] = [];

    const callback = (
      hMonitor: number,
      _hdc: number,
      _lprcClip: number,
      _lParam: number,
    ): boolean => {
      const info = {
        cbSize: koffi.sizeof(MONITORINFOEXW),
        rcMonitor: { left: 0, top: 0, right: 0, bottom: 0 },
        rcWork: { left: 0, top: 0, right: 0, bottom: 0 },
        dwFlags: 0,
        szDevice: new Array<number>(32).fill(0),
      };

      if (!GetMonitorInfoW(hMonitor, info)) {
        return true; // continue enumeration
      }

      // DPI
      const dpiX: number[] = [0];
      const dpiY: number[] = [0];
      GetDpiForMonitor(hMonitor, 0, dpiX, dpiY);
      const dpi = dpiX[0] || DEFAULT_DPI;

      const deviceName = wcharToString(info.szDevice);
      const isPrimary = (info.dwFlags & MONITORINFOF_PRIMARY) !== 0;

      monitors.push({
        id: deviceName,
        name: deviceName,
        bounds: rectFromWin32(info.rcMonitor),
        workArea: rectFromWin32(info.rcWork),
        scaleFactor: dpi / DEFAULT_DPI,
        primary: isPrimary,
      });

      return true; // continue
    };

    const cb = koffi.register(callback, koffi.pointer(EnumDisplayMonitorsProc));
    try {
      const ok = EnumDisplayMonitors(0, 0, cb, 0);
      if (!ok && monitors.length === 0) {
        reject(new Error('EnumDisplayMonitors failed'));
        return;
      }
      resolve(monitors);
    } finally {
      koffi.unregister(cb);
    }
  });
}

export async function getPrimary(): Promise<MonitorInfo> {
  const all = await getAll();
  const primary = all.find((m) => m.primary);
  if (!primary) {
    throw new Error('No primary monitor found');
  }
  return primary;
}
