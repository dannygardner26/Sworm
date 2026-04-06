import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('push-to-talk shortcut behavior', () => {
  it('does not rely on repeated globalShortcut firing plus polling to infer key release', () => {
    const mainPath = join(process.cwd(), 'app', 'main.ts');
    const source = readFileSync(mainPath, 'utf8');

    expect(source).not.toContain('globalShortcut fires repeatedly while held; we detect release when repeats stop');
    expect(source).not.toContain('setInterval(() => {');
    expect(source).not.toContain('if (pttActive && Date.now() - pttLastFire > 300)');
  });

  it('does not bind alt+v as push-to-talk because holding alt re-fires the global shortcut', () => {
    const mainPath = join(process.cwd(), 'app', 'main.ts');
    const source = readFileSync(mainPath, 'utf8');

    expect(source).not.toContain("for (const combo of ['Alt+V', 'F10'])");
    expect(source).toContain("for (const combo of ['F10'])");
  });
});
