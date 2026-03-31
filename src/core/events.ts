import { EventEmitter } from 'node:events';
import type { MonitorInfo } from '../platform/types.js';

export type SwormEventMap = {
  'formation:deploying': [formation: string];
  'formation:deployed': [formation: string];
  'formation:failed': [formation: string, error: Error];
  'worm:spawning': [wormId: string];
  'worm:running': [wormId: string, hwnd: number];
  'worm:positioned': [wormId: string];
  'worm:died': [wormId: string, reason: string];
  'monitor:changed': [monitors: MonitorInfo[]];
  'voice:command': [raw: string, parsed: unknown];
  'hotkey:pressed': [action: string, args?: Record<string, unknown>];
  'worm:visibility': [visible: boolean];
};

type EventName = keyof SwormEventMap;

/**
 * Typed event bus for Sworm system events.
 * Wraps Node.js EventEmitter with strong typing for all event names and payloads.
 */
export class SwormEventBus {
  private emitter = new EventEmitter();

  emit<K extends EventName>(event: K, ...args: SwormEventMap[K]): void {
    this.emitter.emit(event, ...args);
  }

  on<K extends EventName>(event: K, fn: (...args: SwormEventMap[K]) => void): void {
    this.emitter.on(event, fn as (...args: unknown[]) => void);
  }

  off<K extends EventName>(event: K, fn: (...args: SwormEventMap[K]) => void): void {
    this.emitter.off(event, fn as (...args: unknown[]) => void);
  }

  once<K extends EventName>(event: K, fn: (...args: SwormEventMap[K]) => void): void {
    this.emitter.once(event, fn as (...args: unknown[]) => void);
  }

  removeAllListeners(event?: EventName): void {
    this.emitter.removeAllListeners(event);
  }
}
