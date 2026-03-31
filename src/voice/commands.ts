export interface VoiceCommand {
  action:
    | 'deploy'
    | 'kill'
    | 'kill-all'
    | 'status'
    | 'focus'
    | 'list'
    | 'focus-number'
    | 'expand'
    | 'shrink'
    | 'fullscreen'
    | 'minimize-all'
    | 'toggle-visibility';
  target?: string;
}

interface CommandPattern {
  pattern: RegExp;
  action: VoiceCommand['action'];
  extract?: (match: RegExpMatchArray) => Partial<VoiceCommand>;
}

const FILLER_WORDS = /\b(please|the|um|uh|like|just|can you|could you)\b/gi;

const PATTERNS: CommandPattern[] = [
  {
    pattern: /deploy\s+(\w+)(?:\s+formation)?/i,
    action: 'deploy',
    extract: (m) => ({ target: m[1] }),
  },
  { pattern: /switch\s+to\s+(\w+)/i, action: 'deploy', extract: (m) => ({ target: m[1] }) },
  { pattern: /kill\s+(?:all|everything)/i, action: 'kill-all' },
  { pattern: /kill\s+(\w+)/i, action: 'kill', extract: (m) => ({ target: m[1] }) },
  { pattern: /(?:show\s+)?status/i, action: 'status' },
  { pattern: /focus\s+(?:on\s+)?(\w+)/i, action: 'focus', extract: (m) => ({ target: m[1] }) },
  { pattern: /(?:list|what)\s+formations?/i, action: 'list' },
  // Layout commands — must be BEFORE numbered agent focus (which is a catch-all)
  { pattern: /expand\s+(?:agent\s+)?(\d+)/i, action: 'expand', extract: (m) => ({ target: m[1] }) },
  { pattern: /shrink\s+(?:agent\s+)?(\d+)/i, action: 'shrink', extract: (m) => ({ target: m[1] }) },
  {
    pattern: /(?:full\s*screen|maximize)\s+(?:agent\s+)?(\d+)/i,
    action: 'fullscreen',
    extract: (m) => ({ target: m[1] }),
  },
  // Numbered agent focus — must be LAST among digit-matching patterns
  { pattern: /(?:agent\s+)?(\d+)$/i, action: 'focus-number', extract: (m) => ({ target: m[1] }) },
  { pattern: /minimize\s+all/i, action: 'minimize-all' },
  // Show/hide toggle
  { pattern: /(?:show|hide|toggle)\s+(?:all\s+)?(?:worms?|agents?)/i, action: 'toggle-visibility' },
];

export function parseVoiceCommand(text: string): VoiceCommand | null {
  const cleaned = text.toLowerCase().trim().replace(FILLER_WORDS, '').replace(/\s+/g, ' ').trim();
  for (const { pattern, action, extract } of PATTERNS) {
    const match = cleaned.match(pattern);
    if (match) return { action, ...extract?.(match) };
  }
  return null;
}
