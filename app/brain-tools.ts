/**
 * Sworm Brain — Tool definitions and executors
 * Each tool maps to an existing Sworm capability (PTY, app launch, window mgmt).
 */
import { spawn, execSync } from 'node:child_process';

interface MonitorInfo {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
}

interface WindowPlacement {
  monitorId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WindowPlan {
  monitors: MonitorInfo[];
  placements: WindowPlacement[];
  ask: string | null;
}

interface WindowIntent {
  kind: 'ambiguous' | 'app';
  count: number;
  app?: string;
  arrange?: boolean;
}

interface WindowMatch {
  hwnd: number;
  title: string;
}

interface WindowLabel {
  id: number;
  title: string;
}

// ─── Types ───────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  output: string;
  error?: string;
}

export interface BrainContext {
  sendToPty: (msg: Record<string, unknown>) => void;
  waitForPty: (id: string) => Promise<any>;
  createPaneInRenderer: (opts: { id: string; name: string; cmd?: string }) => void;
  getPanes: () => Promise<Array<{ id: string; name: string; number: number; type: string }>>;
  log: (msg: string) => void;
}

// ─── Tool Definitions ────────────────────────────────────

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'create_panes',
    description: 'Create one or more internal Sworm terminal panes. Use cmd "claude" for Claude Code agents (default), or "" for plain shells. Returns the pane IDs. Do not use this for external OS app windows.',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of panes to create (default 1)' },
        name: { type: 'string', description: 'Name prefix for the panes (e.g. "review", "shell")' },
        cmd: { type: 'string', description: 'Command to run. "claude" for Claude Code agent (default), "" for plain shell' },
      },
      required: [],
    },
  },
  {
    name: 'write_to_pane',
    description: 'Write text or a command to a terminal pane. Use this to send prompts to Claude Code agents or run commands in shells. Appends Enter by default.',
    parameters: {
      type: 'object',
      properties: {
        paneId: { type: 'string', description: 'The pane ID to write to' },
        paneNumber: { type: 'number', description: 'Alternative: pane number (1-based) instead of ID' },
        text: { type: 'string', description: 'Text to write to the terminal' },
        pressEnter: { type: 'boolean', description: 'Append Enter after text (default true)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'kill_pane',
    description: 'Kill/close a terminal pane, or kill all panes.',
    parameters: {
      type: 'object',
      properties: {
        paneId: { type: 'string', description: 'Specific pane ID to kill' },
        paneNumber: { type: 'number', description: 'Alternative: pane number (1-based)' },
        all: { type: 'boolean', description: 'Kill all panes' },
      },
      required: [],
    },
  },
  {
    name: 'list_panes',
    description: 'List all active terminal panes with their IDs, names, numbers, and types.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'launch_app',
    description: 'Launch an external application. Supports common app names (chrome, firefox, edge, vscode, notepad, explorer, terminal, spotify, discord, slack) or full executable paths.',
    parameters: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'App name or executable path' },
        args: { type: 'array', items: { type: 'string' }, description: 'Arguments to pass (e.g. URLs, file paths)' },
      },
      required: ['app'],
    },
  },
  {
    name: 'launch_and_arrange',
    description: 'Launch multiple apps AND automatically arrange them side by side on screen. This is the PREFERRED tool when opening multiple apps — it handles launching, waiting for windows, finding them, and tiling them evenly. Always use this instead of calling launch_app + find_windows + arrange_windows separately.',
    parameters: {
      type: 'object',
      properties: {
        apps: { type: 'array', items: { type: 'string' }, description: 'App names to launch (e.g. ["chrome", "spotify"])' },
        layout: { type: 'string', description: 'Optional: "horizontal" (default), "vertical", "grid"' },
      },
      required: ['apps'],
    },
  },
  {
    name: 'open_claude_windows',
    description: 'Launch one or more real Claude Code app windows and arrange them with safe visible placements by default.',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of Claude windows to open' },
        arrange: { type: 'boolean', description: 'Arrange the windows after launch (default true)' },
      },
      required: [],
    },
  },
  {
    name: 'list_claude_windows',
    description: 'Formats real Claude Code windows as numbered targets for AI commands and the on-screen overlay.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'move_claude_window',
    description: 'Move a real Claude Code window selected by its visible overlay number into a directional screen position.',
    parameters: {
      type: 'object',
      properties: {
        windowNumber: { type: 'number', description: 'Visible Claude window number from the overlay/list' },
        position: { type: 'string', description: 'Target position: left, right, top, bottom, maximize' },
      },
      required: ['windowNumber', 'position'],
    },
  },
  {
    name: 'focus_claude_window',
    description: 'Focus a real Claude Code window selected by its visible overlay number.',
    parameters: {
      type: 'object',
      properties: {
        windowNumber: { type: 'number', description: 'Visible Claude window number from the overlay/list' },
      },
      required: ['windowNumber'],
    },
  },
  {
    name: 'wait',
    description: 'Wait for a specified duration. Useful after launching apps before trying to find their windows.',
    parameters: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Milliseconds to wait (max 10000)' },
      },
      required: ['ms'],
    },
  },
  {
    name: 'find_windows',
    description: 'Find open OS windows by title pattern (case-insensitive substring match). Returns window handles (hwnd) and titles.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Substring to search for in window titles (e.g. "Chrome", "Spotify", "Code")' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'move_window',
    description: 'Move and resize a window to a specific position. Use get_screen_info first to know screen dimensions.',
    parameters: {
      type: 'object',
      properties: {
        hwnd: { type: 'number', description: 'Window handle from find_windows' },
        x: { type: 'number', description: 'X position in pixels' },
        y: { type: 'number', description: 'Y position in pixels' },
        width: { type: 'number', description: 'Width in pixels' },
        height: { type: 'number', description: 'Height in pixels' },
      },
      required: ['hwnd', 'x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'get_screen_info',
    description: 'Get screen/monitor dimensions. Returns primary screen width and height.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'arrange_windows',
    description: 'Automatically arrange multiple windows side by side on the screen. Pass window handles and they will be evenly tiled. 2 windows = left/right halves. 3 = thirds. 4 = quadrants. This is the preferred way to arrange windows — do NOT manually calculate positions with move_window.',
    parameters: {
      type: 'object',
      properties: {
        hwnds: { type: 'array', items: { type: 'number' }, description: 'Array of window handles to arrange' },
        layout: { type: 'string', description: 'Optional layout: "horizontal" (side by side, default), "vertical" (stacked), "grid" (auto grid)' },
      },
      required: ['hwnds'],
    },
  },
];

// ─── App Name Resolution ─────────────────────────────────

const APP_MAP: Record<string, { exe: string; args?: string[] }> = {
  chrome: { exe: 'start', args: ['chrome'] },
  'google chrome': { exe: 'start', args: ['chrome'] },
  firefox: { exe: 'start', args: ['firefox'] },
  edge: { exe: 'start', args: ['msedge'] },
  vscode: { exe: 'code' },
  'vs code': { exe: 'code' },
  claude: { exe: 'claude' },
  'claude code': { exe: 'claude' },
  notepad: { exe: 'notepad' },
  'notepad++': { exe: 'notepad++' },
  explorer: { exe: 'explorer' },
  terminal: { exe: 'wt' },
  'windows terminal': { exe: 'wt' },
  cmd: { exe: 'cmd' },
  powershell: { exe: 'powershell' },
  slack: { exe: 'start', args: ['slack'] },
  discord: { exe: 'start', args: ['discord'] },
  spotify: { exe: 'start', args: ['spotify'] },
};

export function inferWindowIntent(input: string): WindowIntent {
  const text = input.toLowerCase();
  const countMatch = text.match(/\b(\d+)\b/);
  const count = countMatch ? Number.parseInt(countMatch[1], 10) : 1;
  const explicitArrange = /good setup|good formation|arrange nicely|nice layout|well arranged/.test(text);
  if (!/\bwindows?\b/.test(text)) {
    return { kind: 'ambiguous', count };
  }
  if (/\bclaude( code)?\b/.test(text)) {
    return { kind: 'app', app: 'claude', count, arrange: explicitArrange || count > 1 };
  }
  return { kind: 'ambiguous', count };
}

export function parseWindowNumberReference(input: string): number | null {
  const match = input.match(/\bwindow\s+(\d+)\b/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function selectClaudeWindowIds(windows: WindowMatch[], count: number): number[] {
  return windows.slice(-count).map((window) => window.hwnd);
}

function getClaudeWindowByNumber(windows: WindowMatch[], windowNumber: number): WindowMatch | null {
  if (!Number.isInteger(windowNumber) || windowNumber < 1) return null;
  return windows[windowNumber - 1] || null;
}

export function formatWindowIdLabel(windows: WindowLabel[]): string {
  if (windows.length === 0) return 'Claude windows\n(none)';
  return ['Claude windows', ...windows.map((window, index) => `[${index + 1}] ${window.title}`)].join('\n');
}

function splitCountAcrossMonitors(count: number, monitorCount: number): number[] {
  const base = Math.floor(count / monitorCount);
  const remainder = count % monitorCount;
  return Array.from({ length: monitorCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

function buildPlacementsForMonitor(monitor: MonitorInfo, count: number): WindowPlacement[] {
  if (count <= 0) return [];
  if (count === 1) {
    return [{ monitorId: monitor.id, x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height }];
  }
  if (count === 2) {
    const width = Math.floor(monitor.width / 2);
    return [
      { monitorId: monitor.id, x: monitor.x, y: monitor.y, width, height: monitor.height },
      { monitorId: monitor.id, x: monitor.x + width, y: monitor.y, width: monitor.width - width, height: monitor.height },
    ];
  }
  if (count === 3) {
    const leftWidth = Math.floor(monitor.width * 0.56);
    const rightWidth = monitor.width - leftWidth;
    const topHeight = Math.floor(monitor.height / 2);
    return [
      { monitorId: monitor.id, x: monitor.x, y: monitor.y, width: leftWidth, height: monitor.height },
      { monitorId: monitor.id, x: monitor.x + leftWidth, y: monitor.y, width: rightWidth, height: topHeight },
      { monitorId: monitor.id, x: monitor.x + leftWidth, y: monitor.y + topHeight, width: rightWidth, height: monitor.height - topHeight },
    ];
  }

  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cellWidth = Math.floor(monitor.width / cols);
  const cellHeight = Math.floor(monitor.height / rows);
  const placements: WindowPlacement[] = [];

  for (let index = 0; index < count; index++) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = monitor.x + col * cellWidth;
    const y = monitor.y + row * cellHeight;
    const width = col === cols - 1 ? monitor.width - cellWidth * col : cellWidth;
    const height = row === rows - 1 ? monitor.height - cellHeight * row : cellHeight;
    placements.push({ monitorId: monitor.id, x, y, width, height });
  }

  return placements;
}

export function buildWindowPlan(options: {
  count: number;
  monitors: MonitorInfo[];
  preferMultiMonitor: boolean;
}): WindowPlan {
  const monitors = [...options.monitors].sort((a, b) => Number(b.primary) - Number(a.primary));
  const maxVisiblePerMonitor = 4;

  if (options.count > monitors.length * maxVisiblePerMonitor) {
    return {
      monitors,
      placements: [],
      ask: `${options.count} windows won't fit cleanly. Spread them smaller or open fewer?`,
    };
  }

  if (!options.preferMultiMonitor || monitors.length === 1 || options.count <= 3) {
    return {
      monitors,
      placements: buildPlacementsForMonitor(monitors[0], options.count),
      ask: null,
    };
  }

  const counts = splitCountAcrossMonitors(options.count, monitors.length);
  const placements = monitors.flatMap((monitor, index) => buildPlacementsForMonitor(monitor, counts[index] || 0));
  return { monitors, placements, ask: null };
}

// ─── Tool Executors ──────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: BrainContext,
): Promise<ToolResult> {
  ctx.log(`[Brain] Tool: ${name}(${JSON.stringify(args)})`);

  switch (name) {
    case 'create_panes': return createPanes(args, ctx);
    case 'write_to_pane': return writeToPaneImpl(args, ctx);
    case 'kill_pane': return killPaneImpl(args, ctx);
    case 'list_panes': return listPanesImpl(ctx);
    case 'launch_app': return launchAppImpl(args);
    case 'launch_and_arrange': return launchAndArrangeImpl(args);
    case 'open_claude_windows': return openClaudeWindowsImpl(args);
    case 'list_claude_windows': return listClaudeWindowsImpl();
    case 'move_claude_window': return moveClaudeWindowImpl(args);
    case 'focus_claude_window': return focusClaudeWindowImpl(args);
    case 'find_windows': return findWindowsImpl(args);
    case 'move_window': return moveWindowImpl(args);
    case 'get_screen_info': return getScreenInfoImpl();
    case 'arrange_windows': return arrangeWindowsImpl(args);
    case 'wait': return waitImpl(args);
    default: return { output: '', error: `Unknown tool: ${name}` };
  }
}

async function createPanes(args: Record<string, unknown>, ctx: BrainContext): Promise<ToolResult> {
  const count = (args.count as number) || 1;
  const name = (args.name as string) || (args.cmd === '' ? 'shell' : 'agent');
  const cmd = args.cmd !== undefined ? String(args.cmd) : 'claude';
  const ids: string[] = [];

  for (let i = 0; i < count; i++) {
    const id = `brain-${Date.now()}-${i}`;
    const paneName = count > 1 ? `${name}-${i + 1}` : name;
    ctx.createPaneInRenderer({ id, name: paneName, cmd: cmd || undefined });
    ids.push(id);
    ctx.log(`[Brain] Created pane: ${paneName} (${id})`);
    // Small delay between panes so renderer can process each
    if (i < count - 1) await new Promise(r => setTimeout(r, 100));
  }

  return { output: `Created ${ids.length} pane(s): ${ids.join(', ')}` };
}

async function writeToPaneImpl(args: Record<string, unknown>, ctx: BrainContext): Promise<ToolResult> {
  const text = args.text as string;
  const pressEnter = args.pressEnter !== false;
  let paneId = args.paneId as string | undefined;

  if (!paneId && args.paneNumber) {
    const panes = await ctx.getPanes();
    const match = panes.find(p => p.number === args.paneNumber);
    if (match) paneId = match.id;
    else return { output: '', error: `No pane with number ${args.paneNumber}` };
  }

  if (!paneId) {
    const panes = await ctx.getPanes();
    if (panes.length === 0) return { output: '', error: 'No active panes' };
    paneId = panes[panes.length - 1].id; // default to most recent
  }

  ctx.sendToPty({ type: 'write', id: paneId, data: text + (pressEnter ? '\r' : '') });
  return { output: `Wrote to pane ${paneId}: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"` };
}

async function killPaneImpl(args: Record<string, unknown>, ctx: BrainContext): Promise<ToolResult> {
  if (args.all) {
    const panes = await ctx.getPanes();
    for (const p of panes) ctx.sendToPty({ type: 'kill', id: p.id });
    return { output: `Killed ${panes.length} pane(s)` };
  }

  let paneId = args.paneId as string | undefined;
  if (!paneId && args.paneNumber) {
    const panes = await ctx.getPanes();
    const match = panes.find(p => p.number === args.paneNumber);
    if (match) paneId = match.id;
  }

  if (!paneId) return { output: '', error: 'No pane specified' };
  ctx.sendToPty({ type: 'kill', id: paneId });
  return { output: `Killed pane ${paneId}` };
}

async function listPanesImpl(ctx: BrainContext): Promise<ToolResult> {
  const panes = await ctx.getPanes();
  if (panes.length === 0) return { output: 'No active panes' };
  const lines = panes.map(p => `[${p.number}] ${p.name} (${p.type}) — id: ${p.id}`);
  return { output: lines.join('\n') };
}

async function launchAppImpl(args: Record<string, unknown>): Promise<ToolResult> {
  const appName = (args.app as string).toLowerCase().trim();
  const extraArgs = (args.args as string[]) || [];

  const mapped = APP_MAP[appName];
  let exe: string;
  let finalArgs: string[];

  if (mapped) {
    exe = mapped.exe;
    finalArgs = [...(mapped.args || []), ...extraArgs];
  } else {
    exe = args.app as string;
    finalArgs = extraArgs;
  }

  try {
    if (exe === 'start') {
      // Windows 'start' needs cmd /c
      spawn('cmd', ['/c', 'start', '', ...finalArgs], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn(exe, finalArgs, { detached: true, stdio: 'ignore' }).unref();
    }
    return { output: `Launched ${args.app}${extraArgs.length ? ' with args: ' + extraArgs.join(' ') : ''}` };
  } catch (e) {
    return { output: '', error: `Failed to launch ${args.app}: ${e}` };
  }
}

async function launchAndArrangeImpl(args: Record<string, unknown>): Promise<ToolResult> {
  const apps = args.apps as string[];
  const layout = (args.layout as string) || 'horizontal';
  if (!apps || apps.length === 0) return { output: '', error: 'No apps specified' };

  // Launch all apps
  for (const app of apps) {
    await launchAppImpl({ app });
  }

  // Wait for windows to appear
  await new Promise(r => setTimeout(r, 3000));

  // Find windows for each app — retry up to 3 times with 1s gaps
  const hwnds: number[] = [];
  const found: string[] = [];
  const titleMap: Record<string, string> = {
    chrome: 'Chrome', 'google chrome': 'Chrome',
    firefox: 'Firefox', edge: 'Edge',
    spotify: 'Spotify', discord: 'Discord',
    slack: 'Slack', vscode: 'Visual Studio Code', 'vs code': 'Visual Studio Code',
    notepad: 'Notepad', terminal: 'Terminal',
  };

  for (let retry = 0; retry < 3 && hwnds.length < apps.length; retry++) {
    if (retry > 0) await new Promise(r => setTimeout(r, 1000));
    for (const app of apps) {
      // Skip if already found
      if (found.some(f => f.startsWith(app + ' '))) continue;
      const pattern = titleMap[app.toLowerCase()] || app;
      const result = await findWindowsImpl({ pattern });
      if (result.output && !result.error && !result.output.startsWith('No windows')) {
        const firstLine = result.output.split('\n')[0];
        const hwndMatch = firstLine.match(/hwnd=(\d+)/);
        if (hwndMatch) {
          hwnds.push(parseInt(hwndMatch[1]));
          found.push(`${app} (hwnd=${hwndMatch[1]})`);
        }
      }
    }
  }

  if (hwnds.length === 0) {
    return { output: `Launched ${apps.join(', ')} but could not find their windows to arrange` };
  }

  // Arrange them
  const arrangeResult = await arrangeWindowsImpl({ hwnds, layout });
  return { output: `Launched and arranged: ${found.join(', ')}. ${arrangeResult.output}` };
}

async function waitImpl(args: Record<string, unknown>): Promise<ToolResult> {
  const ms = Math.min((args.ms as number) || 1000, 10000);
  await new Promise(r => setTimeout(r, ms));
  return { output: `Waited ${ms}ms` };
}

export async function listClaudeWindows(): Promise<WindowMatch[]> {
  const result = await findWindowsImpl({ pattern: 'Claude' });
  if (!result.output || result.error || result.output.startsWith('No windows')) return [];
  return result.output.split('\n').filter(Boolean).map((line) => {
    const hwndMatch = line.match(/hwnd=(\d+)/);
    const titleMatch = line.match(/title="([^"]+)"/);
    return {
      hwnd: hwndMatch ? Number.parseInt(hwndMatch[1], 10) : 0,
      title: titleMatch?.[1] || 'Claude',
    };
  }).filter((window) => window.hwnd !== 0);
}

async function listClaudeWindowsImpl(): Promise<ToolResult> {
  const windows = await listClaudeWindows();
  return {
    output: formatWindowIdLabel(windows.map((window) => ({ id: window.hwnd, title: window.title }))),
  };
}

async function openClaudeWindowsImpl(args: Record<string, unknown>): Promise<ToolResult> {
  const count = Math.max(1, Number(args.count || 1));
  const arrange = args.arrange !== false;
  const apps = Array.from({ length: count }, () => 'claude');
  if (!arrange || count === 1) {
    for (const app of apps) {
      await launchAppImpl({ app });
    }
    return listClaudeWindowsImpl();
  }
  return launchAndArrangeImpl({ apps, layout: 'grid' });
}

async function moveClaudeWindowImpl(args: Record<string, unknown>): Promise<ToolResult> {
  const windowNumber = Number(args.windowNumber);
  const position = String(args.position || '').toLowerCase();
  const windows = await listClaudeWindows();
  const target = getClaudeWindowByNumber(windows, windowNumber);
  if (!target) {
    return { output: '', error: `No Claude window ${windowNumber}` };
  }

  const screenResult = await getScreenInfoImpl();
  if (screenResult.error) return screenResult;
  const monitors = JSON.parse(screenResult.output) as MonitorInfo[];
  const primary = monitors.find((monitor) => monitor.primary) || monitors[0];
  if (!primary) return { output: '', error: 'No monitors available' };

  const halfWidth = Math.floor(primary.width / 2);
  const halfHeight = Math.floor(primary.height / 2);
  const placements: Record<string, WindowPlacement> = {
    left: { monitorId: primary.id, x: primary.x, y: primary.y, width: halfWidth, height: primary.height },
    right: { monitorId: primary.id, x: primary.x + halfWidth, y: primary.y, width: primary.width - halfWidth, height: primary.height },
    top: { monitorId: primary.id, x: primary.x, y: primary.y, width: primary.width, height: halfHeight },
    bottom: { monitorId: primary.id, x: primary.x, y: primary.y + halfHeight, width: primary.width, height: primary.height - halfHeight },
    maximize: { monitorId: primary.id, x: primary.x, y: primary.y, width: primary.width, height: primary.height },
  };

  const placement = placements[position];
  if (!placement) {
    return { output: '', error: `Unsupported Claude window position: ${position}` };
  }

  const moved = await moveWindowImpl({
    hwnd: target.hwnd,
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
  });
  if (moved.error) return moved;
  return { output: `Moved Claude window ${windowNumber} ${position}` };
}

async function focusClaudeWindowImpl(args: Record<string, unknown>): Promise<ToolResult> {
  const windowNumber = Number(args.windowNumber);
  const windows = await listClaudeWindows();
  const target = getClaudeWindowByNumber(windows, windowNumber);
  if (!target) {
    return { output: '', error: `No Claude window ${windowNumber}` };
  }
  try {
    const ps = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WinFocus { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }'; [WinFocus]::ShowWindow([IntPtr]${target.hwnd}, 9); [WinFocus]::SetForegroundWindow([IntPtr]${target.hwnd})`;
    execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 5000 });
    return { output: `Focused Claude window ${windowNumber}` };
  } catch (e) {
    return { output: '', error: `focus_claude_window failed: ${e}` };
  }
}

async function findWindowsImpl(args: Record<string, unknown>): Promise<ToolResult> {
  const pattern = (args.pattern as string) || '';
  try {
    const escaped = pattern.replace(/'/g, "''");
    const ps = `Get-Process | Where-Object { $_.MainWindowTitle -match '${escaped}' -and $_.MainWindowHandle -ne 0 } | ForEach-Object { "$($_.MainWindowHandle)|$($_.MainWindowTitle)" }`;
    const result = execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 5000 }).toString().trim();
    if (!result) return { output: 'No windows found matching "' + pattern + '"' };
    const windows = result.split('\n').filter(Boolean).map(line => {
      const [hwnd, ...titleParts] = line.trim().split('|');
      return { hwnd: parseInt(hwnd), title: titleParts.join('|') };
    });
    return { output: windows.map(w => `hwnd=${w.hwnd} title="${w.title}"`).join('\n') };
  } catch (e) {
    return { output: '', error: `find_windows failed: ${e}` };
  }
}

async function moveWindowImpl(args: Record<string, unknown>): Promise<ToolResult> {
  const hwnd = args.hwnd as number;
  const x = args.x as number;
  const y = args.y as number;
  const width = args.width as number;
  const height = args.height as number;
  try {
    const ps = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WinMgr { [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int h2, bool r); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); }'; [WinMgr]::ShowWindow([IntPtr]${hwnd}, 9); [WinMgr]::MoveWindow([IntPtr]${hwnd}, ${x}, ${y}, ${width}, ${height}, $true)`;
    execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 5000 });
    return { output: `Moved window ${hwnd} to (${x},${y}) ${width}x${height}` };
  } catch (e) {
    return { output: '', error: `move_window failed: ${e}` };
  }
}

async function arrangeWindowsImpl(args: Record<string, unknown>): Promise<ToolResult> {
  const hwnds = args.hwnds as number[];
  if (!hwnds || hwnds.length === 0) return { output: '', error: 'No window handles provided' };

  const screenResult = await getScreenInfoImpl();
  if (screenResult.error) return screenResult;
  const monitors = JSON.parse(screenResult.output) as MonitorInfo[];
  const plan = buildWindowPlan({
    count: hwnds.length,
    monitors,
    preferMultiMonitor: monitors.length > 1 && hwnds.length > 3,
  });
  if (plan.ask) return { output: '', error: plan.ask };

  const results: string[] = [];
  for (let index = 0; index < hwnds.length; index++) {
    const placement = plan.placements[index];
    const moveResult = await moveWindowImpl({
      hwnd: hwnds[index],
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    });
    results.push(moveResult.output || moveResult.error || '');
  }

  return { output: `Arranged ${hwnds.length} windows: ${results.join('; ')}` };
}

async function getScreenInfoImpl(): Promise<ToolResult> {
  try {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { "$($_.DeviceName)|$($_.WorkingArea.X)|$($_.WorkingArea.Y)|$($_.WorkingArea.Width)|$($_.WorkingArea.Height)|$($_.Primary)" }`;
    const result = execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 5000 }).toString().trim();
    const screens = result.split('\n').filter(Boolean).map((line) => {
      const [id, x, y, width, height, primary] = line.split('|');
      return { id, x: Number(x), y: Number(y), width: Number(width), height: Number(height), primary: primary === 'True' };
    });
    return { output: JSON.stringify(screens) };
  } catch (e) {
    return { output: '', error: `get_screen_info failed: ${e}` };
  }
}
