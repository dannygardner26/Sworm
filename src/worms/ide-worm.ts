import path from 'node:path';
import { Worm } from '../core/worm.js';
import type { WormConfig } from '../config/schema.js';
import type { PlatformAPI } from '../platform/types.js';

interface IDEWormParams {
  folder: string;
  files?: string[];
  workspace?: string;
}

export class IDEWorm extends Worm {
  readonly type = 'ide';
  private pid: number | null = null;
  private folder: string = '';

  constructor(id: string, config: WormConfig, platform: PlatformAPI) {
    super(id, config, platform);
  }

  async spawn(): Promise<void> {
    this.status = 'spawning';

    const params = this.config.params as unknown as IDEWormParams;
    if (!params.folder && !params.workspace) {
      throw new Error(`IDEWorm ${this.id}: "folder" or "workspace" param is required`);
    }

    this.folder = params.folder ? path.resolve(params.folder) : '';

    const args: string[] = ['--new-window'];

    if (params.workspace) {
      args.push(path.resolve(params.workspace));
    } else {
      args.push(this.folder);
    }

    if (params.files) {
      for (const file of params.files) {
        args.push(path.resolve(file));
      }
    }

    const spawned = await this.platform.processes.spawn('code', args, { detached: true });
    this.pid = spawned.pid;
    this.status = 'running';
  }

  async findWindow(): Promise<number> {
    const folderName = this.folder
      ? path.basename(this.folder)
      : path.basename((this.config.params as unknown as IDEWormParams).workspace ?? '');

    const pattern = new RegExp(`${escapeRegExp(folderName)}.*Visual Studio Code`, 'i');
    const hwnds = await this.platform.windows.findByTitle(pattern);

    if (hwnds.length === 0) {
      throw new Error(`IDEWorm ${this.id}: no VS Code window found matching "${pattern.source}"`);
    }

    return hwnds[0];
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
