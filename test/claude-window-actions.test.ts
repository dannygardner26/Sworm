import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Claude window action wiring', () => {
  it('adds a dedicated tool for targeting a Claude window by overlay number', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'brain-tools.ts'), 'utf8');
    expect(source).toContain("name: 'move_claude_window'");
    expect(source).toContain('Move a real Claude Code window selected by its visible overlay number');
  });

  it('executes the Claude window targeting tool through the main tool dispatcher', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'brain-tools.ts'), 'utf8');
    expect(source).toContain("case 'move_claude_window': return moveClaudeWindowImpl(args);");
  });

  it('supports directional placement requests for numbered Claude windows', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'brain-tools.ts'), 'utf8');
    expect(source).toContain('position');
    expect(source).toContain('left');
    expect(source).toContain('right');
    expect(source).toContain('top');
    expect(source).toContain('bottom');
    expect(source).toContain('maximize');
  });

  it('tells the brain how to move Claude windows by visible number', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'brain.ts'), 'utf8');
    expect(source).toContain('When the user asks to move, maximize, or position a Claude window by number, use move_claude_window');
  });
});
