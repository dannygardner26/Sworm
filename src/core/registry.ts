import type { WormConfig } from '../config/schema.js';
import type { PlatformAPI } from '../platform/types.js';
import type { Worm } from './worm.js';

export type WormConstructor = new (
  id: string,
  config: WormConfig,
  platform: PlatformAPI,
) => Worm;

export class WormTypeRegistry {
  private types = new Map<string, WormConstructor>();

  register(type: string, ctor: WormConstructor): void {
    this.types.set(type, ctor);
  }

  create(config: WormConfig, platform: PlatformAPI): Worm {
    const Ctor = this.types.get(config.type);
    if (!Ctor) throw new Error(`Unknown worm type: ${config.type}`);
    return new Ctor(config.id, config, platform);
  }

  has(type: string): boolean {
    return this.types.has(type);
  }

  getTypes(): string[] {
    return [...this.types.keys()];
  }
}
