/**
 * Sworm Brain — Tool definitions and executors
 * Each tool maps to an existing Sworm capability (PTY, app launch, window mgmt).
 */
import { spawn, execSync } from 'node:child_process';

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
  getPanes: () => Promise<Array<{ id: string; name: string; number: number; type: string }>>;
  log: (msg: string) => void;
}

// ─── Tool Definitions ────────────────────────────────────

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'create_panes',
    description: 'Create one or more terminal panes. Use cmd "claude" for Claude Code agents (default), or "" for plain shells. Returns the pane IDs.',
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
    ctx.sendToPty({ type: 'create', id, cmd: cmd || undefined, cwd: process.cwd() });
    try {
      await ctx.waitForPty(id);
      ids.push(id);
      ctx.log(`[Brain] Created pane: ${paneName} (${id})`);
    } catch (e) {
      ctx.log(`[Brain] Failed to create pane: ${e}`);
    }
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
  const layout = (args.layout as string) || 'horizontal';
  if (!hwnds || hwnds.length === 0) return { output: '', error: 'No window handles provided' };

  // Get screen dimensions
  const screenResult = await getScreenInfoImpl();
  if (screenResult.error) return screenResult;
  const match = screenResult.output.match(/(\d+)x(\d+)/);
  if (!match) return { output: '', error: 'Could not parse screen dimensions' };
  const screenW = parseInt(match[1]);
  const screenH = parseInt(match[2]);

  const results: string[] = [];
  const n = hwnds.length;

  for (let i = 0; i < n; i++) {
    let x = 0, y = 0, w = screenW, h = screenH;

    if (layout === 'vertical') {
      h = Math.floor(screenH / n);
      y = i * h;
    } else if (layout === 'grid' && n > 2) {
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const col = i % cols;
      const row = Math.floor(i / cols);
      w = Math.floor(screenW / cols);
      h = Math.floor(screenH / rows);
      x = col * w;
      y = row * h;
    } else {
      // horizontal (default) — side by side
      w = Math.floor(screenW / n);
      x = i * w;
    }

    const moveResult = await moveWindowImpl({ hwnd: hwnds[i], x, y, width: w, height: h });
    results.push(moveResult.output || moveResult.error || '');
  }

  return { output: `Arranged ${n} windows (${layout}): ${results.join('; ')}` };
}

async function getScreenInfoImpl(): Promise<ToolResult> {
  try {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea | ForEach-Object { "$($_.Width)|$($_.Height)" }`;
    const result = execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 5000 }).toString().trim();
    const [w, h] = result.split('|').map(Number);
    return { output: `Primary screen: ${w}x${h} (working area)` };
  } catch (e) {
    return { output: '', error: `get_screen_info failed: ${e}` };
  }
}
