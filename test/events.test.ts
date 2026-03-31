import { describe, it, expect, vi } from 'vitest';
import { SwormEventBus } from '../src/core/events.js';

describe('SwormEventBus', () => {
  it('emits and receives events', () => {
    const bus = new SwormEventBus();
    const handler = vi.fn();
    bus.on('formation:deployed', handler);
    bus.emit('formation:deployed', 'pilot');
    expect(handler).toHaveBeenCalledWith('pilot');
  });

  it('once fires only once', () => {
    const bus = new SwormEventBus();
    const handler = vi.fn();
    bus.once('worm:spawning', handler);
    bus.emit('worm:spawning', 'w1');
    bus.emit('worm:spawning', 'w2');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('w1');
  });

  it('off removes handler', () => {
    const bus = new SwormEventBus();
    const handler = vi.fn();
    bus.on('formation:deployed', handler);
    bus.off('formation:deployed', handler);
    bus.emit('formation:deployed', 'pilot');
    expect(handler).not.toHaveBeenCalled();
  });

  it('removeAllListeners clears specific event', () => {
    const bus = new SwormEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('formation:deployed', h1);
    bus.on('worm:spawning', h2);
    bus.removeAllListeners('formation:deployed');
    bus.emit('formation:deployed', 'x');
    bus.emit('worm:spawning', 'y');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalled();
  });

  it('passes multiple args correctly', () => {
    const bus = new SwormEventBus();
    const handler = vi.fn();
    bus.on('worm:running', handler);
    bus.emit('worm:running', 'w1', 12345);
    expect(handler).toHaveBeenCalledWith('w1', 12345);
  });

  it('error event passes Error object', () => {
    const bus = new SwormEventBus();
    const handler = vi.fn();
    bus.on('formation:failed', handler);
    const err = new Error('boom');
    bus.emit('formation:failed', 'pilot', err);
    expect(handler).toHaveBeenCalledWith('pilot', err);
  });
});
