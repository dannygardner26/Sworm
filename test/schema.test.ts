import { describe, it, expect } from 'vitest';
import {
  FormationConfigSchema,
  WormConfigSchema,
  ZonePositionSchema,
} from '../src/config/schema.js';

describe('ZonePositionSchema', () => {
  it('accepts all valid zones', () => {
    const zones = [
      'full', 'left-half', 'right-half', 'top-half', 'bottom-half',
      'top-left', 'top-right', 'bottom-left', 'bottom-right',
      'center-third', 'left-third', 'right-third',
    ];
    for (const zone of zones) {
      expect(ZonePositionSchema.parse(zone)).toBe(zone);
    }
  });

  it('rejects invalid zones', () => {
    expect(() => ZonePositionSchema.parse('middle')).toThrow();
  });
});

describe('WormConfigSchema', () => {
  it('parses minimal worm config with defaults', () => {
    const result = WormConfigSchema.parse({
      id: 'test',
      type: 'generic',
      position: { zone: 'full' },
    });
    expect(result.monitor).toBe('primary');
    expect(result.params).toEqual({});
  });

  it('accepts all worm types', () => {
    for (const type of ['claude', 'ide', 'generic', 'app', 'ai-agent']) {
      const result = WormConfigSchema.parse({
        id: 'test',
        type,
        position: { zone: 'full' },
      });
      expect(result.type).toBe(type);
    }
  });

  it('rejects unknown worm type', () => {
    expect(() =>
      WormConfigSchema.parse({ id: 'x', type: 'docker', position: { zone: 'full' } }),
    ).toThrow();
  });

  it('rejects missing id', () => {
    expect(() =>
      WormConfigSchema.parse({ type: 'generic', position: { zone: 'full' } }),
    ).toThrow();
  });

  it('accepts grid position', () => {
    const result = WormConfigSchema.parse({
      id: 'test',
      type: 'generic',
      position: { grid: { col: 0, row: 0 } },
    });
    expect(result.position).toHaveProperty('grid');
  });

  it('accepts absolute position with percentages', () => {
    const result = WormConfigSchema.parse({
      id: 'test',
      type: 'generic',
      position: { absolute: { x: '10%', y: '20%', width: '50%', height: '50%' } },
    });
    expect(result.position).toHaveProperty('absolute');
  });
});

describe('FormationConfigSchema', () => {
  const minimal = {
    name: 'test',
    worms: [{ id: 'w1', type: 'generic', position: { zone: 'full' } }],
  };

  it('parses minimal formation', () => {
    const result = FormationConfigSchema.parse(minimal);
    expect(result.name).toBe('test');
    expect(result.worms).toHaveLength(1);
  });

  it('defaults mode to normal', () => {
    const result = FormationConfigSchema.parse(minimal);
    expect(result.mode).toBe('normal');
  });

  it('accepts wallpaper mode', () => {
    const result = FormationConfigSchema.parse({ ...minimal, mode: 'wallpaper' });
    expect(result.mode).toBe('wallpaper');
  });

  it('rejects empty worms array', () => {
    expect(() =>
      FormationConfigSchema.parse({ name: 'test', worms: [] }),
    ).toThrow();
  });

  it('accepts monitor aliases', () => {
    const result = FormationConfigSchema.parse({
      ...minimal,
      monitors: { main: 'primary', side: 'right' },
    });
    expect(result.monitors).toEqual({ main: 'primary', side: 'right' });
  });

  it('accepts hooks', () => {
    const result = FormationConfigSchema.parse({
      ...minimal,
      hooks: { pre: ['echo starting'], post: ['echo done'] },
    });
    expect(result.hooks?.pre).toEqual(['echo starting']);
  });

  it('accepts grid config', () => {
    const result = FormationConfigSchema.parse({
      ...minimal,
      grid: { columns: 6, rows: 4, gap: 8 },
    });
    expect(result.grid?.columns).toBe(6);
  });
});
