import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Claude window runtime behavior', () => {
  it('refreshes the overlay after Claude windows are opened', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'main.ts'), 'utf8');
    expect(source).toContain("'window:refresh-ids'");
    expect(source).toContain('void sendWindowIds()');
  });

  it('supports focusing a Claude window by overlay number', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'brain-tools.ts'), 'utf8');
    expect(source).toContain("name: 'focus_claude_window'");
    expect(source).toContain('Focus a real Claude Code window selected by its visible overlay number');
    expect(source).toContain("case 'focus_claude_window': return focusClaudeWindowImpl(args);");
  });

  it('teaches the brain to focus numbered Claude windows', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'brain.ts'), 'utf8');
    expect(source).toContain('When the user asks to focus, open, or bring a Claude window to the front by number, use focus_claude_window');
  });
});
