import type { PlatformAPI } from '../platform/types.js';
import type { Worm, WormStatusInfo } from './worm.js';
import type { FormationConfig } from '../config/schema.js';
import { WormTypeRegistry } from './registry.js';
import { SwormEventBus } from './events.js';
import { FormationLoader, resolveMonitor, resolvePosition } from './formation.js';
import { WormNumbering } from './numbering.js';
import { validateFormation, type ValidationResult } from './validate.js';
import { runHooks, HookError } from './hooks.js';

export class Swarm {
  private platform: PlatformAPI;
  private registry: WormTypeRegistry;
  private eventBus: SwormEventBus;
  private activeWorms = new Map<string, Worm>();
  private formationLoader: FormationLoader;
  private activeFormation: string | null = null;
  private numbering = new WormNumbering();
  private visible = true;

  constructor(platform: PlatformAPI, registry: WormTypeRegistry, formationsDir?: string) {
    this.platform = platform;
    this.registry = registry;
    this.eventBus = new SwormEventBus();
    this.formationLoader = new FormationLoader(formationsDir);
  }

  async deploy(formationName: string, opts?: { force?: boolean }): Promise<void> {
    // If force, kill existing worms first
    if (opts?.force && this.activeWorms.size > 0) {
      await this.kill();
    }

    this.eventBus.emit('formation:deploying', formationName);

    let config;
    try {
      config = this.formationLoader.load(formationName);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.eventBus.emit('formation:failed', formationName, error);
      throw error;
    }

    await this.deployConfig(config, opts);
  }

  async deployConfig(config: FormationConfig, opts?: { force?: boolean }): Promise<void> {
    // If force, kill existing worms first
    if (opts?.force && this.activeWorms.size > 0) {
      await this.kill();
    }

    const formationName = config.name;
    const monitors = await this.platform.monitors.getAll();

    // Pre-flight validation — fail fast before any process is spawned
    const validation = validateFormation(config, monitors, this.registry);
    if (!validation.valid) {
      const lines = validation.issues.map((issue) =>
        issue.wormId ? `  [${issue.wormId}] ${issue.message}` : `  ${issue.message}`,
      );
      const error = new Error(
        `Formation "${formationName}" failed pre-flight validation:\n${lines.join('\n')}`,
      );
      this.eventBus.emit('formation:failed', formationName, error);
      throw error;
    }

    // Run pre-deploy hooks — failure aborts the deploy before anything is spawned
    if (config.hooks?.pre?.length) {
      try {
        await runHooks(config.hooks.pre, 'pre', { formation: formationName }, (cmd) => {
          this.eventBus.emit('hook:running', 'pre', cmd);
        });
      } catch (err) {
        const error = err instanceof HookError ? err : new Error(String(err));
        this.eventBus.emit('hook:failed', 'pre', err instanceof HookError ? err.command : '', error);
        this.eventBus.emit('formation:failed', formationName, error);
        throw error;
      }
    }

    // Deploy worms sequentially so each can accurately detect its new window
    let failureCount = 0;
    for (const wormConfig of config.worms) {
      try {
        const monitorRef = config.monitors?.[wormConfig.monitor] ?? wormConfig.monitor;
        const monitor = resolveMonitor(monitorRef, monitors);
        const rect = resolvePosition(wormConfig.position, monitor, config.grid);

        const worm = this.registry.create(wormConfig, this.platform);

        this.eventBus.emit('worm:spawning', worm.id);
        await worm.spawn();

        await worm.waitForWindow();
        this.eventBus.emit('worm:running', worm.id, worm.hwnd!);

        await worm.position(rect);
        this.eventBus.emit('worm:positioned', worm.id);

        this.activeWorms.set(worm.id, worm);

        const num = this.numbering.assign(worm.id);
        worm.wormNumber = num;
        await this.platform.windows.setTitle(worm.hwnd!, `[${num}] ${worm.id}`);
      } catch (err) {
        failureCount++;
        const msg = err instanceof Error ? err.message : String(err);
        this.eventBus.emit('worm:died', wormConfig.id, msg);
      }
    }

    if (failureCount > 0) {
      const error = new Error(`${failureCount}/${config.worms.length} worms failed to deploy`);
      this.eventBus.emit('formation:failed', formationName, error);
      if (failureCount === config.worms.length) {
        throw error;
      }
    }

    this.activeFormation = formationName;

    // Apply wallpaper mode if configured (best-effort, won't crash if WorkerW unavailable)
    if (config.mode === 'wallpaper') {
      try {
        const { parentToDesktop, setWallpaperStyle } =
          await import('../platform/windows/wallpaper.js');
        for (const worm of this.activeWorms.values()) {
          if (worm.hwnd) {
            try {
              setWallpaperStyle(worm.hwnd);
              parentToDesktop(worm.hwnd);
            } catch {
              // Wallpaper parenting failed for this worm, continue with normal z-order
              await worm.sendToBack();
            }
          }
        }
      } catch {
        // Wallpaper mode unavailable, fall back to sending all to back
        await this.sendAllToBack();
      }
    }

    // Run post-deploy hooks — failure is a warning, worms are already running
    if (config.hooks?.post?.length) {
      try {
        await runHooks(config.hooks.post, 'post', { formation: formationName }, (cmd) => {
          this.eventBus.emit('hook:running', 'post', cmd);
        });
      } catch (err) {
        const error = err instanceof HookError ? err : new Error(String(err));
        this.eventBus.emit('hook:failed', 'post', err instanceof HookError ? err.command : '', error);
      }
    }

    this.eventBus.emit('formation:deployed', formationName, this.activeWorms.size);
  }

  async kill(target?: string): Promise<void> {
    if (!target) {
      // Remove wallpaper parenting before closing windows
      const { removeWallpaperStyle } = await import('../platform/windows/wallpaper.js');
      for (const worm of this.activeWorms.values()) {
        if (worm.hwnd) {
          try {
            removeWallpaperStyle(worm.hwnd);
          } catch {}
        }
      }

      // Kill all active worms
      const killPromises = [...this.activeWorms.values()].map(async (worm) => {
        await worm.kill();
        this.eventBus.emit('worm:died', worm.id, 'killed');
      });
      await Promise.allSettled(killPromises);
      this.activeWorms.clear();
      this.numbering.reset();
      const killedFormation = this.activeFormation;
      this.activeFormation = null;
      this.eventBus.emit('formation:killed', killedFormation);
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
      this.numbering.remove(target);
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

  async focusByNumber(n: number): Promise<void> {
    const wormId = this.numbering.getByNumber(n);
    if (!wormId) throw new Error(`No worm with number ${n}`);
    const worm = this.activeWorms.get(wormId);
    if (!worm) throw new Error(`Worm ${wormId} not found`);
    await worm.focus();
  }

  getByNumber(n: number): string | undefined {
    return this.numbering.getByNumber(n);
  }

  async toggleVisibility(): Promise<void> {
    if (this.visible) {
      await this.sendAllToBack();
    } else {
      await this.bringAllToFront();
    }
    this.visible = !this.visible;
  }

  async sendAllToBack(): Promise<void> {
    for (const worm of this.activeWorms.values()) {
      if (worm.hwnd) await worm.sendToBack();
    }
  }

  async bringAllToFront(): Promise<void> {
    for (const worm of this.activeWorms.values()) {
      if (worm.hwnd) await worm.focus();
    }
  }

  async validate(config: FormationConfig): Promise<ValidationResult> {
    const monitors = await this.platform.monitors.getAll();
    return validateFormation(config, monitors, this.registry);
  }

  async expandWorm(wormId: string): Promise<void> {
    const worm = this.activeWorms.get(wormId);
    if (!worm?.hwnd) throw new Error(`Worm ${wormId} not found or has no window`);
    const monitors = await this.platform.monitors.getAll();
    const monitor = resolveMonitor(worm.config.monitor, monitors);
    // Expand to full monitor
    await worm.position(monitor.workArea);
  }

  async fullscreenWorm(wormId: string): Promise<void> {
    await this.expandWorm(wormId);
  }

  /** Returns IDs of all currently running AI agent worms. */
  getAgentWormIds(): string[] {
    return [...this.activeWorms.values()]
      .filter((w) => w.type === 'ai-agent')
      .map((w) => w.id);
  }
}
