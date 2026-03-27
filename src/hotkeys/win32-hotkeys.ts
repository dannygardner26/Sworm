import koffi from 'koffi';

const user32 = koffi.load('user32.dll');

// MSG struct for PeekMessage
const POINT = koffi.struct('HKPOINT', { x: 'long', y: 'long' });
const MSG = koffi.struct('HKMSG', {
  hwnd: 'long',
  message: 'uint',
  wParam: 'ulong',
  lParam: 'long',
  time: 'uint',
  pt: POINT,
});

const RegisterHotKey = user32.func('bool RegisterHotKey(long hWnd, int id, uint fsModifiers, uint vk)');
const UnregisterHotKey = user32.func('bool UnregisterHotKey(long hWnd, int id)');
const PeekMessageW = user32.func('bool PeekMessageW(_Out_ HKMSG *lpMsg, long hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg)');

const WM_HOTKEY = 0x0312;
const PM_REMOVE = 0x0001;

export class Win32HotkeyBackend {
  private registeredIds = new Set<number>();

  register(id: number, modifiers: number, vk: number): boolean {
    const result = RegisterHotKey(0, id, modifiers, vk) as boolean;
    if (result) {
      this.registeredIds.add(id);
    }
    return result;
  }

  unregister(id: number): boolean {
    const result = UnregisterHotKey(0, id) as boolean;
    if (result) {
      this.registeredIds.delete(id);
    }
    return result;
  }

  poll(): number | null {
    const msg = {} as Record<string, unknown>;
    const hasMessage = PeekMessageW(msg, 0, WM_HOTKEY, WM_HOTKEY, PM_REMOVE) as boolean;
    if (hasMessage && (msg as { message: number }).message === WM_HOTKEY) {
      return (msg as { wParam: number }).wParam;
    }
    return null;
  }

  dispose(): void {
    for (const id of this.registeredIds) {
      UnregisterHotKey(0, id);
    }
    this.registeredIds.clear();
  }
}
