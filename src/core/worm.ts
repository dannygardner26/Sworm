import type { WormConfig } from '../config/schema.js';
import type { PlatformAPI, Rect } from '../platform/types.js';

export type WormStatus = 'created' | 'spawning' | 'running' | 'positioned' | 'dead';

export interface WormStatusInfo {
  id: string;
  type: string;
  status: WormStatus;
  hwnd: number | null;
  number?: number;
}

export abstract class Worm {
  abstract readonly type: string;

  public id: string;
  public config: WormConfig;
  public hwnd: number | null = null;
  public status: WormStatus = 'created';
  public wormNumber: number | undefined;
  protected platform: PlatformAPI;

  constructor(id: string, config: WormConfig, platform: PlatformAPI) {
    this.id = id;
    this.config = config;
    this.platform = platform;
  }

  abstract spawn(): Promise<void>;
  abstract findWindow(): Promise<number>;

  async position(rect: Rect): Promise<void> {
    if (this.hwnd === null) {
      throw new Error(`Worm ${this.id} has no window handle`);
    }
    await this.platform.windows.restore(this.hwnd);
    await this.platform.windows.move(this.hwnd, rect);
    this.status = 'positioned';
  }

  async focus(): Promise<void> {
    if (this.hwnd === null) {
      throw new Error(`Worm ${this.id} has no window handle`);
    }
    await this.platform.windows.focus(this.hwnd);
  }

  async sendToBack(): Promise<void> {
    if (this.hwnd === null) {
      throw new Error(`Worm ${this.id} has no window handle`);
    }
    await this.platform.windows.sendToBack(this.hwnd);
  }

  async kill(): Promise<void> {
    if (this.hwnd !== null) {
      await this.platform.windows.close(this.hwnd);
    }
    this.status = 'dead';
  }

  getStatus(): WormStatusInfo {
    return {
      id: this.id,
      type: this.type,
      status: this.status,
      hwnd: this.hwnd,
      number: this.wormNumber,
    };
  }

  async waitForWindow(timeout = 10000): Promise<void> {
    const interval = 200;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        const hwnd = await this.findWindow();
        if (hwnd) {
          this.hwnd = hwnd;
          this.status = 'running';
          return;
        }
      } catch {
        // Window not found yet, keep polling
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(`Worm ${this.id}: window not found within ${timeout}ms`);
  }
}
