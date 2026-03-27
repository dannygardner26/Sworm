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

  constructor(id: string, config: WormConfig, platform: PlatformAPI) {
    super(id, config, platform);
  }

  async spawn(): Promise<void> {
    this.status = 'spawning';

    const params = this.config.params as unknown as GenericWormParams;
    if (!params.executable) {
      throw new Error(`GenericWorm ${this.id}: "executable" param is required`);
    }

    const args = params.args ?? [];
    const spawned = await this.platform.processes.spawn(params.executable, args, {
      detached: true,
    });

    this.pid = spawned.pid;
    this.status = 'running';
  }

  async findWindow(): Promise<number> {
    if (this.pid === null) {
      throw new Error(`GenericWorm ${this.id}: process not spawned yet`);
    }

    const hwnds = await this.platform.windows.findByProcess(this.pid);
    if (hwnds.length === 0) {
      throw new Error(`GenericWorm ${this.id}: no windows found for pid ${this.pid}`);
    }

    return hwnds[0];
  }
}
