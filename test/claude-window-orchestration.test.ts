import { describe, it, expect } from 'vitest';
import {
  buildWindowPlan,
  formatWindowIdLabel,
  inferWindowIntent,
  parseWindowNumberReference,
  selectClaudeWindowIds,
} from '../app/brain-tools.js';

describe('inferWindowIntent', () => {
  it('marks multiple claude windows for arrangement by default', () => {
    expect(inferWindowIntent('open 3 new claude windows')).toEqual({
      kind: 'app',
      app: 'claude',
      count: 3,
      arrange: true,
    });
  });
});

describe('window numbering', () => {
  it('formats numbered Claude window labels for the overlay', () => {
    expect(formatWindowIdLabel([
      { id: 101, title: 'Claude 1' },
      { id: 205, title: 'Claude 2' },
    ])).toBe('Claude windows\n[1] Claude 1\n[2] Claude 2');
  });

  it('extracts the referenced window number from AI text', () => {
    expect(parseWindowNumberReference('move window 2 to the left monitor')).toBe(2);
  });

  it('keeps the newest Claude windows when selecting arranged windows', () => {
    expect(selectClaudeWindowIds([
      { hwnd: 11, title: 'old' },
      { hwnd: 12, title: 'older' },
      { hwnd: 30, title: 'new-1' },
      { hwnd: 31, title: 'new-2' },
    ], 2)).toEqual([30, 31]);
  });
});

describe('buildWindowPlan', () => {
  it('uses multiple monitors for four windows when available', () => {
    const plan = buildWindowPlan({
      count: 4,
      monitors: [
        { id: 'm1', x: 0, y: 0, width: 1728, height: 1117, primary: true },
        { id: 'm2', x: 1728, y: 0, width: 1728, height: 1117, primary: false },
      ],
      preferMultiMonitor: true,
    });

    expect(plan.ask).toBeNull();
    expect(new Set(plan.placements.map((placement) => placement.monitorId))).toEqual(new Set(['m1', 'm2']));
  });
});
