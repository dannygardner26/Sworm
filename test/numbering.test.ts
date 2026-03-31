import { describe, it, expect, beforeEach } from 'vitest';
import { WormNumbering } from '../src/core/numbering.js';

describe('WormNumbering', () => {
  let numbering: WormNumbering;

  beforeEach(() => {
    numbering = new WormNumbering();
  });

  it('assigns sequential numbers starting at 1', () => {
    expect(numbering.assign('alpha')).toBe(1);
    expect(numbering.assign('beta')).toBe(2);
    expect(numbering.assign('gamma')).toBe(3);
  });

  it('looks up worm id by number', () => {
    numbering.assign('alpha');
    numbering.assign('beta');
    expect(numbering.getByNumber(1)).toBe('alpha');
    expect(numbering.getByNumber(2)).toBe('beta');
    expect(numbering.getByNumber(99)).toBeUndefined();
  });

  it('looks up number by worm id', () => {
    numbering.assign('alpha');
    expect(numbering.getNumber('alpha')).toBe(1);
    expect(numbering.getNumber('missing')).toBeUndefined();
  });

  it('removes a worm', () => {
    numbering.assign('alpha');
    numbering.assign('beta');
    numbering.remove('alpha');
    expect(numbering.getByNumber(1)).toBeUndefined();
    expect(numbering.getNumber('alpha')).toBeUndefined();
    // beta still intact
    expect(numbering.getByNumber(2)).toBe('beta');
  });

  it('removing nonexistent worm is a no-op', () => {
    numbering.remove('ghost');
    // no throw
  });

  it('reset clears everything and restarts numbering', () => {
    numbering.assign('alpha');
    numbering.assign('beta');
    numbering.reset();
    expect(numbering.getByNumber(1)).toBeUndefined();
    expect(numbering.getByNumber(2)).toBeUndefined();
    // New assignments start at 1 again
    expect(numbering.assign('gamma')).toBe(1);
  });

  it('numbers keep incrementing after removal (no reuse)', () => {
    numbering.assign('a'); // 1
    numbering.assign('b'); // 2
    numbering.remove('a');
    expect(numbering.assign('c')).toBe(3); // not 1
  });
});
