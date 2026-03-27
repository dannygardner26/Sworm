export interface VoiceCommand {
  action: 'deploy' | 'kill' | 'kill-all' | 'status' | 'focus' | 'list';
  target?: string;
}

interface CommandPattern {
  pattern: RegExp;
  action: VoiceCommand['action'];
  extract?: (match: RegExpMatchArray) => Partial<VoiceCommand>;
}

const FILLER_WORDS = /\b(please|the|um|uh|like|just|can you|could you)\b/gi;

const PATTERNS: CommandPattern[] = [
  { pattern: /deploy\s+(\w+)(?:\s+formation)?/i, action: 'deploy', extract: (m) => ({ target: m[1] }) },
  { pattern: /switch\s+to\s+(\w+)/i, action: 'deploy', extract: (m) => ({ target: m[1] }) },
  { pattern: /kill\s+(?:all|everything)/i, action: 'kill-all' },
  { pattern: /kill\s+(\w+)/i, action: 'kill', extract: (m) => ({ target: m[1] }) },
  { pattern: /(?:show\s+)?status/i, action: 'status' },
  { pattern: /focus\s+(?:on\s+)?(\w+)/i, action: 'focus', extract: (m) => ({ target: m[1] }) },
  { pattern: /(?:list|what)\s+formations?/i, action: 'list' },
];

export function parseVoiceCommand(text: string): VoiceCommand | null {
  const cleaned = text.toLowerCase().trim().replace(FILLER_WORDS, '').replace(/\s+/g, ' ').trim();
  for (const { pattern, action, extract } of PATTERNS) {
    const match = cleaned.match(pattern);
    if (match) return { action, ...extract?.(match) };
  }
  return null;
}
