import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('window ID visibility', () => {
  it('registers a shortcut to toggle window IDs', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'main.ts'), 'utf8');
    expect(source).toContain("showIdsKey");
    expect(source).toContain("toggle-window-ids");
  });

  it('exposes a preload listener for window ID visibility updates', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'preload.ts'), 'utf8');
    expect(source).toContain('onWindowIds');
    expect(source).toContain("window:ids");
  });

  it('renders a window ID overlay container in the UI', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'renderer', 'index.html'), 'utf8');
    expect(source).toContain('window-id-overlay');
  });

  it('handles toggle-window-ids events in the renderer', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'renderer', 'renderer.js'), 'utf8');
    expect(source).toContain('toggle-window-ids');
    expect(source).toContain('window-id-overlay');
  });
});
