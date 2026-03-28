import { Worm } from '../core/worm.js';
import type { WormConfig } from '../config/schema.js';
import type { PlatformAPI } from '../platform/types.js';

interface GenericWormParams {
  executable: string;
  args?: string[];
}

export class GenericWorm extends Worm {
  readonly type = 'generic';
  private pid: number | null = null;
  private windowsBefore: Set<number> = new Set();

  constructor(id: string, config: WormConfig, platform: PlatformAPI) {
    super(id, config, platform);
  }

  async spawn(): Promise<void> {
    this.status = 'spawning';

    const params = this.config.params as unknown as GenericWormParams;
    if (!params.executable) {
      throw new Error(`GenericWorm ${this.id}: "executable" param is required`);
    }

    // Snapshot current windows before spawning
    const before = await this.platform.windows.findByTitle(/./);
    this.windowsBefore = new Set(before);

    const args = params.args ?? [];
    const spawned = await this.platform.processes.spawn(params.executable, args, {
      detached: true,
    });

    this.pid = spawned.pid;
    this.status = 'running';
  }

  async findWindow(): Promise<number> {
    // Find new windows that appeared after spawn
    const current = await this.platform.windows.findByTitle(/./);
    const newWindows = current.filter(h => !this.windowsBefore.has(h));

    if (newWindows.length > 0) {
      return newWindows[0];
    }

    // Fallback: try by PID
    if (this.pid !== null) {
      const byPid = await this.platform.windows.findByProcess(this.pid);
      if (byPid.length > 0) return byPid[0];
    }

    throw new Error(`GenericWorm ${this.id}: no new windows found`);
  }
}
