import { describe, it, expect } from 'vitest';
import { resolveMonitor, resolvePosition } from '../src/core/formation.js';
import type { MonitorInfo, Rect } from '../src/platform/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRIMARY: MonitorInfo = {
  id: 'monitor-0',
  name: 'Primary',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
  primary: true,
};

const LEFT: MonitorInfo = {
  id: 'monitor-1',
  name: 'Left',
  bounds: { x: -2560, y: 0, width: 2560, height: 1440 },
  workArea: { x: -2560, y: 0, width: 2560, height: 1400 },
  scaleFactor: 1.25,
  primary: false,
};

const RIGHT: MonitorInfo = {
  id: 'monitor-2',
  name: 'Right',
  bounds: { x: 1920, y: -200, width: 2560, height: 1440 },
  workArea: { x: 1920, y: -200, width: 2560, height: 1400 },
  scaleFactor: 1.25,
  primary: false,
};

const MONITORS = [PRIMARY, LEFT, RIGHT];

// ---------------------------------------------------------------------------
// resolveMonitor
// ---------------------------------------------------------------------------

describe('resolveMonitor', () => {
  it('resolves "primary"', () => {
    expect(resolveMonitor('primary', MONITORS)).toBe(PRIMARY);
  });

  it('resolves "left" to leftmost monitor', () => {
    expect(resolveMonitor('left', MONITORS)).toBe(LEFT);
  });

  it('resolves "right" to rightmost monitor', () => {
    expect(resolveMonitor('right', MONITORS)).toBe(RIGHT);
  });

  it('resolves "top" to topmost monitor', () => {
    // RIGHT has y=-200, lowest y value
    expect(resolveMonitor('top', MONITORS)).toBe(RIGHT);
  });

  it('resolves "bottom" to bottommost monitor', () => {
    // PRIMARY and LEFT both have y=0, but reduce picks the last match (LEFT)
    expect(resolveMonitor('bottom', MONITORS)).toBe(LEFT);
  });

  it('resolves "index:0"', () => {
    expect(resolveMonitor('index:0', MONITORS)).toBe(PRIMARY);
  });

  it('resolves "index:2"', () => {
    expect(resolveMonitor('index:2', MONITORS)).toBe(RIGHT);
  });

  it('throws on out-of-range index', () => {
    expect(() => resolveMonitor('index:5', MONITORS)).toThrow('out of range');
  });

  it('throws on negative index', () => {
    expect(() => resolveMonitor('index:-1', MONITORS)).toThrow('out of range');
  });

  it('throws on unknown ref', () => {
    expect(() => resolveMonitor('secondary', MONITORS)).toThrow('Unknown monitor reference');
  });

  it('throws when no monitors available', () => {
    expect(() => resolveMonitor('primary', [])).toThrow('No monitors');
  });

  it('throws when primary requested but none flagged', () => {
    const noPrimary = MONITORS.map((m) => ({ ...m, primary: false }));
    expect(() => resolveMonitor('primary', noPrimary)).toThrow('No primary');
  });
});

// ---------------------------------------------------------------------------
// resolvePosition — zone mode
// ---------------------------------------------------------------------------

describe('resolvePosition — zones', () => {
  const wa = PRIMARY.workArea; // 0,0 1920x1040

  it('full zone covers entire work area', () => {
    const r = resolvePosition({ zone: 'full' }, PRIMARY);
    expect(r).toEqual(wa);
  });

  it('left-half', () => {
    const r = resolvePosition({ zone: 'left-half' }, PRIMARY);
    expect(r).toEqual({ x: 0, y: 0, width: 960, height: 1040 });
  });

  it('right-half', () => {
    const r = resolvePosition({ zone: 'right-half' }, PRIMARY);
    expect(r).toEqual({ x: 960, y: 0, width: 960, height: 1040 });
  });

  it('top-left quadrant', () => {
    const r = resolvePosition({ zone: 'top-left' }, PRIMARY);
    expect(r).toEqual({ x: 0, y: 0, width: 960, height: 520 });
  });

  it('bottom-right quadrant', () => {
    const r = resolvePosition({ zone: 'bottom-right' }, PRIMARY);
    expect(r).toEqual({ x: 960, y: 520, width: 960, height: 520 });
  });

  it('left-third', () => {
    const r = resolvePosition({ zone: 'left-third' }, PRIMARY);
    expect(r).toEqual({ x: 0, y: 0, width: 640, height: 1040 });
  });

  it('center-third', () => {
    const r = resolvePosition({ zone: 'center-third' }, PRIMARY);
    expect(r).toEqual({ x: 640, y: 0, width: 640, height: 1040 });
  });

  it('right-third', () => {
    const r = resolvePosition({ zone: 'right-third' }, PRIMARY);
    expect(r).toEqual({ x: 1280, y: 0, width: 640, height: 1040 });
  });

  it('zones respect monitor offset', () => {
    const r = resolvePosition({ zone: 'left-half' }, LEFT);
    expect(r).toEqual({ x: -2560, y: 0, width: 1280, height: 1400 });
  });

  it('zones respect negative Y offset', () => {
    const r = resolvePosition({ zone: 'top-left' }, RIGHT);
    expect(r).toEqual({ x: 1920, y: -200, width: 1280, height: 700 });
  });
});

// ---------------------------------------------------------------------------
// resolvePosition — grid mode
// ---------------------------------------------------------------------------

describe('resolvePosition — grid', () => {
  const grid = { columns: 4, rows: 2, gap: 0 };

  it('basic cell at origin', () => {
    const r = resolvePosition(
      { grid: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
      PRIMARY,
      grid,
    );
    expect(r).toEqual({ x: 0, y: 0, width: 480, height: 520 });
  });

  it('cell spanning multiple columns', () => {
    const r = resolvePosition(
      { grid: { col: 0, row: 0, colSpan: 2, rowSpan: 1 } },
      PRIMARY,
      grid,
    );
    expect(r).toEqual({ x: 0, y: 0, width: 960, height: 520 });
  });

  it('cell at non-origin position', () => {
    const r = resolvePosition(
      { grid: { col: 2, row: 1, colSpan: 1, rowSpan: 1 } },
      PRIMARY,
      grid,
    );
    expect(r).toEqual({ x: 960, y: 520, width: 480, height: 520 });
  });

  it('uses default grid (12x6, gap 4) when none provided', () => {
    const r = resolvePosition(
      { grid: { col: 0, row: 0, colSpan: 12, rowSpan: 6 } },
      PRIMARY,
    );
    // Should approximately fill the work area (minus gaps)
    expect(r.width).toBeGreaterThan(1800);
    expect(r.height).toBeGreaterThan(900);
  });

  it('grid with gap', () => {
    const gapped = { columns: 2, rows: 2, gap: 10 };
    const r = resolvePosition(
      { grid: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
      PRIMARY,
      gapped,
    );
    // cellW = (1920 - 10*3) / 2 = 945
    // cellH = (1040 - 10*3) / 2 = 505
    // x = 0 + 10 + 0*(945+10) = 10
    // y = 0 + 10 + 0*(505+10) = 10
    expect(r.x).toBe(10);
    expect(r.y).toBe(10);
    expect(r.width).toBe(945);
    expect(r.height).toBe(505);
  });
});

// ---------------------------------------------------------------------------
// resolvePosition — absolute mode
// ---------------------------------------------------------------------------

describe('resolvePosition — absolute', () => {
  it('pixel values', () => {
    const r = resolvePosition(
      { absolute: { x: 100, y: 50, width: 800, height: 600 } },
      PRIMARY,
    );
    expect(r).toEqual({ x: 100, y: 50, width: 800, height: 600 });
  });

  it('percentage values', () => {
    const r = resolvePosition(
      { absolute: { x: '10%', y: '10%', width: '50%', height: '50%' } },
      PRIMARY,
    );
    expect(r).toEqual({ x: 192, y: 104, width: 960, height: 520 });
  });

  it('mixed pixel and percentage', () => {
    const r = resolvePosition(
      { absolute: { x: 0, y: '25%', width: '100%', height: 300 } },
      PRIMARY,
    );
    expect(r).toEqual({ x: 0, y: 260, width: 1920, height: 300 });
  });

  it('absolute respects monitor offset', () => {
    const r = resolvePosition(
      { absolute: { x: 100, y: 50, width: 800, height: 600 } },
      LEFT,
    );
    // x is relative to workArea.x
    expect(r.x).toBe(-2560 + 100);
    expect(r.y).toBe(0 + 50);
  });
});
