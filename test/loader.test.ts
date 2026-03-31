import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { loadFormation, listFormations } from '../src/config/loader.js';

const FORMATIONS_DIR = join(import.meta.dirname, '..', 'formations');

describe('listFormations', () => {
  it('returns all formation names', () => {
    const names = listFormations(FORMATIONS_DIR);
    expect(names).toContain('pilot');
    expect(names).toContain('debug');
    expect(names).toContain('review');
    expect(names.length).toBeGreaterThanOrEqual(3);
  });

  it('names do not include .yaml extension', () => {
    const names = listFormations(FORMATIONS_DIR);
    for (const name of names) {
      expect(name).not.toContain('.yaml');
    }
  });
});

describe('loadFormation', () => {
  it('loads pilot formation', () => {
    const config = loadFormation('pilot', FORMATIONS_DIR);
    expect(config.name).toBe('pilot');
    expect(config.worms.length).toBeGreaterThanOrEqual(1);
  });

  it('loads debug formation', () => {
    const config = loadFormation('debug', FORMATIONS_DIR);
    expect(config.name).toBe('debug');
  });

  it('loads review formation', () => {
    const config = loadFormation('review', FORMATIONS_DIR);
    expect(config.name).toBe('review');
  });

  it('all listed formations load and validate', () => {
    const names = listFormations(FORMATIONS_DIR);
    for (const name of names) {
      const config = loadFormation(name, FORMATIONS_DIR);
      expect(config.name).toBe(name);
      expect(config.worms.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('throws on nonexistent formation', () => {
    expect(() => loadFormation('nonexistent', FORMATIONS_DIR)).toThrow();
  });

  it('every worm has a valid type', () => {
    const validTypes = ['claude', 'ide', 'generic', 'app', 'ai-agent'];
    const names = listFormations(FORMATIONS_DIR);
    for (const name of names) {
      const config = loadFormation(name, FORMATIONS_DIR);
      for (const worm of config.worms) {
        expect(validTypes).toContain(worm.type);
      }
    }
  });
});
