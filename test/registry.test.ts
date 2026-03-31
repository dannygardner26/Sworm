import { describe, it, expect, beforeEach } from 'vitest';
import { WormTypeRegistry } from '../src/core/registry.js';
import { Worm } from '../src/core/worm.js';
import type { WormConfig } from '../src/config/schema.js';
import type { PlatformAPI } from '../src/platform/types.js';

class FakeWorm extends Worm {
  readonly type = 'fake';
  async spawn() { /* noop */ }
  async findWindow() { return 12345; }
}

const fakePlatform = {} as PlatformAPI;

const fakeConfig: WormConfig = {
  id: 'test-worm',
  type: 'fake' as any,
  monitor: 'primary',
  position: { zone: 'full' },
  params: {},
};

describe('WormTypeRegistry', () => {
  let registry: WormTypeRegistry;

  beforeEach(() => {
    registry = new WormTypeRegistry();
  });

  it('registers and creates a worm type', () => {
    registry.register('fake', FakeWorm);
    const worm = registry.create(fakeConfig, fakePlatform);
    expect(worm).toBeInstanceOf(FakeWorm);
    expect(worm.id).toBe('test-worm');
  });

  it('has() returns true for registered types', () => {
    registry.register('fake', FakeWorm);
    expect(registry.has('fake')).toBe(true);
    expect(registry.has('unknown')).toBe(false);
  });

  it('getTypes() lists registered types', () => {
    registry.register('fake', FakeWorm);
    registry.register('other', FakeWorm);
    expect(registry.getTypes()).toEqual(['fake', 'other']);
  });

  it('throws on unknown type', () => {
    expect(() => registry.create(fakeConfig, fakePlatform)).toThrow('Unknown worm type');
  });
});
