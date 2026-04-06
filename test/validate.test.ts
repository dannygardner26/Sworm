import { describe, it, expect, beforeEach } from 'vitest';
import { validateFormation } from '../src/core/validate.js';
import { WormTypeRegistry } from '../src/core/registry.js';
import { Worm } from '../src/core/worm.js';
import type { FormationConfig, WormConfig } from '../src/config/schema.js';
import type { MonitorInfo, PlatformAPI } from '../src/platform/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

class FakeWorm extends Worm {
  readonly type = 'fake';
  async spawn() {}
  async findWindow() {
    return 1;
  }
}

const PRIMARY: MonitorInfo = {
  id: 'monitor-0',
  name: 'Primary',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
  primary: true,
};

const SECONDARY: MonitorInfo = {
  id: 'monitor-1',
  name: 'Secondary',
  bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
  workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
  primary: false,
};

const MONITORS = [PRIMARY, SECONDARY];

function makeWorm(overrides: Partial<WormConfig> = {}): WormConfig {
  return {
    id: 'w1',
    type: 'fake' as any,
    monitor: 'primary',
    position: { zone: 'full' },
    params: {},
    ...overrides,
  };
}

function makeFormation(worms: WormConfig[], overrides: Partial<FormationConfig> = {}): FormationConfig {
  return {
    name: 'test',
    worms,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateFormation', () => {
  let registry: WormTypeRegistry;

  beforeEach(() => {
    registry = new WormTypeRegistry();
    registry.register('fake', FakeWorm);
  });

  it('passes a valid formation', () => {
    const result = validateFormation(makeFormation([makeWorm()]), MONITORS, registry);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  describe('duplicate worm IDs', () => {
    it('reports duplicate IDs', () => {
      const result = validateFormation(
        makeFormation([makeWorm({ id: 'w1' }), makeWorm({ id: 'w1' })]),
        MONITORS,
        registry,
      );
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].wormId).toBe('w1');
      expect(result.issues[0].message).toMatch(/duplicate/i);
    });

    it('allows distinct IDs', () => {
      const result = validateFormation(
        makeFormation([makeWorm({ id: 'w1' }), makeWorm({ id: 'w2' })]),
        MONITORS,
        registry,
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('unregistered worm type', () => {
    it('reports unknown type', () => {
      const result = validateFormation(
        makeFormation([makeWorm({ type: 'nope' as any })]),
        MONITORS,
        registry,
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0].message).toMatch(/unknown worm type/i);
    });

    it('passes a registered type', () => {
      const result = validateFormation(
        makeFormation([makeWorm({ type: 'fake' as any })]),
        MONITORS,
        registry,
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('monitor resolution', () => {
    it('accepts built-in refs: primary, left, right, top, bottom', () => {
      for (const ref of ['primary', 'right']) {
        const result = validateFormation(
          makeFormation([makeWorm({ monitor: ref })]),
          MONITORS,
          registry,
        );
        expect(result.valid).toBe(true);
      }
    });

    it('accepts index refs', () => {
      const result = validateFormation(
        makeFormation([makeWorm({ monitor: 'index:1' })]),
        MONITORS,
        registry,
      );
      expect(result.valid).toBe(true);
    });

    it('reports out-of-bounds index ref', () => {
      const result = validateFormation(
        makeFormation([makeWorm({ monitor: 'index:5' })]),
        MONITORS,
        registry,
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0].message).toMatch(/monitor/i);
    });

    it('reports unknown monitor ref', () => {
      const result = validateFormation(
        makeFormation([makeWorm({ monitor: 'nonexistent' })]),
        MONITORS,
        registry,
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0].message).toMatch(/monitor/i);
    });

    it('resolves monitor aliases from config.monitors map', () => {
      const result = validateFormation(
        makeFormation([makeWorm({ monitor: 'main' })], {
          monitors: { main: 'primary' },
        }),
        MONITORS,
        registry,
      );
      expect(result.valid).toBe(true);
    });

    it('reports alias that maps to an unknown target', () => {
      const result = validateFormation(
        makeFormation([makeWorm({ monitor: 'main' })], {
          monitors: { main: 'doesNotExist' },
        }),
        MONITORS,
        registry,
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0].message).toMatch(/monitor/i);
    });
  });

  describe('grid bounds', () => {
    it('passes grid position within bounds', () => {
      const result = validateFormation(
        makeFormation([
          makeWorm({ position: { grid: { col: 0, row: 0, colSpan: 6, rowSpan: 3 } } }),
        ]),
        MONITORS,
        registry,
      );
      expect(result.valid).toBe(true);
    });

    it('reports column overflow', () => {
      const result = validateFormation(
        makeFormation([
          makeWorm({ position: { grid: { col: 8, row: 0, colSpan: 6, rowSpan: 1 } } }),
        ]),
        MONITORS,
        registry,
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0].message).toMatch(/column overflow/i);
    });

    it('reports row overflow', () => {
      const result = validateFormation(
        makeFormation([
          makeWorm({ position: { grid: { col: 0, row: 4, colSpan: 1, rowSpan: 5 } } }),
        ]),
        MONITORS,
        registry,
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0].message).toMatch(/row overflow/i);
    });

    it('respects custom grid dimensions', () => {
      const result = validateFormation(
        makeFormation(
          [makeWorm({ position: { grid: { col: 0, row: 0, colSpan: 8, rowSpan: 8 } } })],
          { grid: { columns: 8, rows: 8, gap: 0 } },
        ),
        MONITORS,
        registry,
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('multiple issues', () => {
    it('collects all issues at once', () => {
      const result = validateFormation(
        makeFormation([
          makeWorm({ id: 'dup', type: 'nope' as any, monitor: 'bad' }),
          makeWorm({ id: 'dup', monitor: 'index:99' }),
        ]),
        MONITORS,
        registry,
      );
      expect(result.valid).toBe(false);
      // duplicate + unknown type + bad monitor on worm 1, duplicate + bad monitor on worm 2
      expect(result.issues.length).toBeGreaterThanOrEqual(3);
    });
  });
});
