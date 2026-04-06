import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Claude window runtime wiring', () => {
  it('adds a tool for listing Claude windows with numeric IDs', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'brain-tools.ts'), 'utf8');
    expect(source).toContain("name: 'list_claude_windows'");
    expect(source).toContain('Formats real Claude Code windows as numbered targets');
  });

  it('adds a tool for arranging Claude windows by count', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'brain-tools.ts'), 'utf8');
    expect(source).toContain("name: 'open_claude_windows'");
    expect(source).toContain('Launch one or more real Claude Code app windows');
  });

  it('instructs the brain to use numeric Claude window IDs', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'brain.ts'), 'utf8');
    expect(source).toContain('When the user refers to Claude windows by number, use the numbered Claude window list');
  });

  it('updates the main process overlay with numbered Claude windows', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'main.ts'), 'utf8');
    expect(source).toContain('listClaudeWindows');
    expect(source).toContain("formatWindowIdLabel(");
  });
});
