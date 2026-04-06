import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('brain prompt semantics', () => {
  it('does not map open windows directly to Claude panes', () => {
    const brainPath = join(process.cwd(), 'app', 'brain.ts');
    const source = readFileSync(brainPath, 'utf8');
    expect(source).not.toContain('When asked to "open agents" or "open windows", create Claude Code panes');
  });

  it('tells the model to clarify ambiguous window requests', () => {
    const brainPath = join(process.cwd(), 'app', 'brain.ts');
    const source = readFileSync(brainPath, 'utf8');
    expect(source).toContain('If the user asks for "windows" without a clear target app, ask a brief clarification question');
  });

  it('forbids tool use for bare ambiguous window requests', () => {
    const brainPath = join(process.cwd(), 'app', 'brain.ts');
    const source = readFileSync(brainPath, 'utf8');
    expect(source).toContain('For bare requests like "open 4 new windows", do not call any tool until the user clarifies the target app');
  });

  it('treats claude windows as Claude Code app windows', () => {
    const brainPath = join(process.cwd(), 'app', 'brain.ts');
    const source = readFileSync(brainPath, 'utf8');
    expect(source).toContain('"Claude windows" means Claude Code app windows, not internal panes');
  });

  it('tells the model to auto-arrange multiple app windows safely', () => {
    const brainPath = join(process.cwd(), 'app', 'brain.ts');
    const source = readFileSync(brainPath, 'utf8');
    expect(source).toContain('If the user asks for a good setup or formation for multiple app windows, arrange them automatically using safe visible placements');
  });

  it('does not treat the literal word window as a direct pane shortcut in typed commands', () => {
    const rendererPath = join(process.cwd(), 'app', 'renderer', 'renderer.js');
    const rendererSource = readFileSync(rendererPath, 'utf8');
    expect(rendererSource).not.toContain('\\b(agent|claude|tab|pane|window)\\b');
  });
});
