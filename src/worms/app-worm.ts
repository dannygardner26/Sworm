import { Worm } from '../core/worm.js';
import type { WormConfig } from '../config/schema.js';
import type { PlatformAPI } from '../platform/types.js';

interface AppWormParams {
  app: 'chrome' | 'firefox' | 'edge' | 'brave' | string;
  url?: string;
  profile?: string;
  args?: string[];
}

const BROWSER_PATHS: Record<string, string> = {
  chrome: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  edge: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  firefox: 'C:/Program Files/Mozilla Firefox/firefox.exe',
  brave: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
};

const CHROMIUM_BROWSERS = new Set(['chrome', 'edge', 'brave']);

export class AppWorm extends Worm {
  readonly type = 'app';
  private pid: number | null = null;
  private appParams: AppWormParams | null = null;

  constructor(id: string, config: WormConfig, platform: PlatformAPI) {
    super(id, config, platform);
  }

  async spawn(): Promise<void> {
    this.status = 'spawning';

    const params = this.config.params as unknown as AppWormParams;
    if (!params.app) {
      throw new Error(`AppWorm ${this.id}: "app" param is required`);
    }

    this.appParams = params;

    const executable = BROWSER_PATHS[params.app] ?? params.app;
    const isChromium = CHROMIUM_BROWSERS.has(params.app);
    const args: string[] = [];

    if (isChromium) {
      args.push('--new-window');
    }

    if (params.profile && isChromium) {
      args.push(`--profile-directory=${params.profile}`);
    }

    if (params.url) {
      args.push(params.url);
    }

    if (params.args) {
      args.push(...params.args);
    }

    const spawned = await this.platform.processes.spawn(executable, args, { detached: true });
    this.pid = spawned.pid;
    this.status = 'running';
  }

  async findWindow(): Promise<number> {
    if (!this.appParams) {
      throw new Error(`AppWorm ${this.id}: process not spawned yet`);
    }

    // Try matching by URL or app name in window title
    const searchTerm = this.appParams.url ?? this.appParams.app;
    const pattern = new RegExp(escapeRegExp(searchTerm), 'i');
    const hwnds = await this.platform.windows.findByTitle(pattern);

    if (hwnds.length === 0) {
      throw new Error(`AppWorm ${this.id}: no windows found matching "${pattern.source}"`);
    }

    return hwnds[0];
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
