import koffi from 'koffi';

// ── Constants ──────────────────────────────────────────────────────────
const WH_KEYBOARD_LL = 13;
const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const WM_SYSKEYDOWN = 0x0104;
const WM_SYSKEYUP = 0x0105;
const HC_ACTION = 0;
const PM_REMOVE = 0x0001;

// ── Structs ────────────────────────────────────────────────────────────
const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
  vkCode: 'uint32',
  scanCode: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr',
});

const POINT = koffi.struct('LLKPOINT', { x: 'long', y: 'long' });
const MSG = koffi.struct('LLKMSG', {
  hwnd: 'long',
  message: 'uint',
  wParam: 'ulong',
  lParam: 'long',
  time: 'uint',
  pt: POINT,
});

// ── FFI bindings ───────────────────────────────────────────────────────
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const LowLevelKeyboardProc = koffi.proto(
  'LowLevelKeyboardProc',
  'intptr',
  ['int', 'uintptr', 'KBDLLHOOKSTRUCT*'],
);

const SetWindowsHookExW = user32.func(
  'pointer SetWindowsHookExW(int idHook, LowLevelKeyboardProc* lpfn, pointer hMod, uint dwThreadId)',
);
const UnhookWindowsHookEx = user32.func('bool UnhookWindowsHookEx(pointer hhk)');
const CallNextHookEx = user32.func(
  'intptr CallNextHookEx(pointer hhk, int nCode, uintptr wParam, KBDLLHOOKSTRUCT* lParam)',
);
const PeekMessageW = user32.func(
  'bool PeekMessageW(_Out_ LLKMSG* lpMsg, long hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg)',
);
const GetModuleHandleW = kernel32.func('pointer GetModuleHandleW(pointer lpModuleName)');

// ── Types ──────────────────────────────────────────────────────────────
export type KeyEventType = 'down' | 'up';
export type KeyEventCallback = (vk: number, type: KeyEventType) => boolean;

// ── Class ──────────────────────────────────────────────────────────────
export class KeyboardHookBackend {
  private hook: unknown = null;
  // Store the registered callback to prevent garbage collection
  private registeredCallback: unknown = null;

  install(callback: KeyEventCallback): void {
    if (this.hook) {
      throw new Error('Hook already installed');
    }

    const hookProc = (
      nCode: number,
      wParam: number,
      lParam: { vkCode: number; scanCode: number; flags: number; time: number; dwExtraInfo: number },
    ): number => {
      if (nCode === HC_ACTION) {
        const vk = lParam.vkCode;
        let eventType: KeyEventType;

        if (wParam === WM_KEYDOWN || wParam === WM_SYSKEYDOWN) {
          eventType = 'down';
        } else if (wParam === WM_KEYUP || wParam === WM_SYSKEYUP) {
          eventType = 'up';
        } else {
          return CallNextHookEx(this.hook, nCode, wParam, lParam) as number;
        }

        const suppress = callback(vk, eventType);
        if (suppress) {
          return 1;
        }
      }
      return CallNextHookEx(this.hook, nCode, wParam, lParam) as number;
    };

    this.registeredCallback = koffi.register(hookProc, koffi.pointer(LowLevelKeyboardProc));
    const hMod = GetModuleHandleW(null);
    this.hook = SetWindowsHookExW(WH_KEYBOARD_LL, this.registeredCallback, hMod, 0);

    if (!this.hook) {
      this.registeredCallback = null;
      throw new Error('SetWindowsHookExW failed');
    }
  }

  uninstall(): void {
    if (this.hook) {
      UnhookWindowsHookEx(this.hook);
      this.hook = null;
    }
    if (this.registeredCallback) {
      koffi.unregister(this.registeredCallback as Parameters<typeof koffi.unregister>[0]);
      this.registeredCallback = null;
    }
  }

  pumpMessages(): void {
    const msg = {} as Record<string, unknown>;
    while (PeekMessageW(msg, 0, 0, 0, PM_REMOVE) as boolean) {
      // Drain the message queue so the LL hook callback fires
    }
  }
}
