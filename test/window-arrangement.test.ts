import { describe, it, expect } from 'vitest';
import { buildWindowPlan, inferWindowIntent } from '../app/brain-tools.js';

describe('inferWindowIntent', () => {
  it('treats bare window requests as ambiguous', () => {
    expect(inferWindowIntent('open 3 new windows')).toEqual({
      kind: 'ambiguous',
      count: 3,
    });
  });

  it('treats claude windows as Claude Code app windows', () => {
    expect(inferWindowIntent('open 3 new claude windows')).toEqual({
      kind: 'app',
      app: 'claude',
      count: 3,
      arrange: true,
    });
  });

  it('detects default arrangement for multiple claude windows', () => {
    expect(inferWindowIntent('open 3 new claude windows')).toMatchObject({
      kind: 'app',
      app: 'claude',
      count: 3,
    });
  });

  it('detects arrangement language for claude windows', () => {
    expect(inferWindowIntent('open 3 new claude windows in a good formation')).toEqual({
      kind: 'app',
      app: 'claude',
      count: 3,
      arrange: true,
    });
  });
});

describe('buildWindowPlan', () => {
  it('keeps a three-window primary layout fully inside one monitor', () => {
    const plan = buildWindowPlan({
      count: 3,
      monitors: [
        { id: 'm1', x: 0, y: 0, width: 1920, height: 1080, primary: true },
      ],
      preferMultiMonitor: false,
    });

    expect(plan.ask).toBeNull();
    expect(plan.placements).toHaveLength(3);
    for (const placement of plan.placements) {
      expect(placement.x).toBeGreaterThanOrEqual(0);
      expect(placement.y).toBeGreaterThanOrEqual(0);
      expect(placement.x + placement.width).toBeLessThanOrEqual(1920);
      expect(placement.y + placement.height).toBeLessThanOrEqual(1080);
    }
  });

  it('spreads windows across monitors before suggesting a compromised layout', () => {
    const plan = buildWindowPlan({
      count: 5,
      monitors: [
        { id: 'm1', x: 0, y: 0, width: 1440, height: 900, primary: true },
        { id: 'm2', x: 1440, y: 0, width: 1440, height: 900, primary: false },
      ],
      preferMultiMonitor: true,
    });

    expect(plan.ask).toBeNull();
    expect(new Set(plan.placements.map((placement) => placement.monitorId)).size).toBeGreaterThan(1);
    for (const placement of plan.placements) {
      const monitor = plan.monitors.find((entry) => entry.id === placement.monitorId)!;
      expect(placement.x).toBeGreaterThanOrEqual(monitor.x);
      expect(placement.y).toBeGreaterThanOrEqual(monitor.y);
      expect(placement.x + placement.width).toBeLessThanOrEqual(monitor.x + monitor.width);
      expect(placement.y + placement.height).toBeLessThanOrEqual(monitor.y + monitor.height);
    }
  });

  it('asks before using a compromised layout when no monitor can fit all windows visibly', () => {
    const plan = buildWindowPlan({
      count: 7,
      monitors: [
        { id: 'm1', x: 0, y: 0, width: 1280, height: 720, primary: true },
      ],
      preferMultiMonitor: true,
    });

    expect(plan.placements).toHaveLength(0);
    expect(plan.ask).toContain("won't fit cleanly");
  });
});
