import type { PlatformAPI } from '../platform/types.js';
import type { Worm, WormStatusInfo } from './worm.js';
import { WormTypeRegistry } from './registry.js';
import { SwormEventBus } from './events.js';
import { FormationLoader, resolveMonitor, resolvePosition } from './formation.js';

export class Swarm {
  private platform: PlatformAPI;
  private registry: WormTypeRegistry;
  private eventBus: SwormEventBus;
  private activeWorms = new Map<string, Worm>();
  private formationLoader: FormationLoader;
  private activeFormation: string | null = null;

  constructor(
    platform: PlatformAPI,
    registry: WormTypeRegistry,
    formationsDir?: string,
  ) {
    this.platform = platform;
    this.registry = registry;
    this.eventBus = new SwormEventBus();
    this.formationLoader = new FormationLoader(formationsDir);
  }

  async deploy(
    formationName: string,
    opts?: { force?: boolean },
  ): Promise<void> {
    // If force, kill existing worms first
    if (opts?.force && this.activeWorms.size > 0) {
      await this.kill();
    }

    this.eventBus.emit('formation:deploying', formationName);

    let config;
    try {
      config = this.formationLoader.load(formationName);
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error(String(err));
      this.eventBus.emit('formation:failed', formationName, error);
      throw error;
    }

    const monitors = await this.platform.monitors.getAll();

    const results = await Promise.allSettled(
      config.worms.map(async (wormConfig) => {
        const monitor = resolveMonitor(wormConfig.monitor, monitors);
        const rect = resolvePosition(
          wormConfig.position,
          monitor,
          config.grid,
        );

        const worm = this.registry.create(wormConfig, this.platform);

        this.eventBus.emit('worm:spawning', worm.id);
        await worm.spawn();

        await worm.waitForWindow();
        this.eventBus.emit('worm:running', worm.id, worm.hwnd!);

        await worm.position(rect);
        this.eventBus.emit('worm:positioned', worm.id);

        this.activeWorms.set(worm.id, worm);
      }),
    );

    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    if (failures.length > 0) {
      const error = new Error(
        `${failures.length}/${config.worms.length} worms failed to deploy`,
      );
      this.eventBus.emit('formation:failed', formationName, error);
      // If all failed, throw
      if (failures.length === config.worms.length) {
        throw error;
      }
    }

    this.activeFormation = formationName;
    this.eventBus.emit('formation:deployed', formationName);
  }

  async kill(target?: string): Promise<void> {
    if (!target) {
      // Kill all active worms
      const killPromises = [...this.activeWorms.values()].map(async (worm) => {
        await worm.kill();
        this.eventBus.emit('worm:died', worm.id, 'killed');
      });
      await Promise.allSettled(killPromises);
      this.activeWorms.clear();
      this.activeFormation = null;
      return;
    }

    // Check if target matches formation name
    if (target === this.activeFormation) {
      await this.kill();
      return;
    }

    // Check if target matches a worm id
    const worm = this.activeWorms.get(target);
    if (worm) {
      await worm.kill();
      this.eventBus.emit('worm:died', worm.id, 'killed');
      this.activeWorms.delete(target);
      return;
    }

    throw new Error(`No formation or worm found matching: ${target}`);
  }

  status(): WormStatusInfo[] {
    return [...this.activeWorms.values()].map((w) => w.getStatus());
  }

  getEventBus(): SwormEventBus {
    return this.eventBus;
  }
}
