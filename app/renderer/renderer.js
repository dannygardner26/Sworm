// Access the Sworm API exposed by preload
const sworm = window.sworm;

// ─── State ────────────────────────────────────────────
const state = {
  panes: new Map(), // id -> { terminal, fitAddon, number, name, cmd, active, element }
  focusedPane: null,
  paneCounter: 0,
  commandPaletteOpen: false,
  selectedResultIndex: 0,
};

// ─── Pane Management ──────────────────────────────────

async function createPane(opts = {}) {
  const number = ++state.paneCounter;
  const id = opts.id || `agent-${number}`;
  const name = opts.name || id;
  const cmd = opts.cmd || 'claude'; // Default to Claude Code!
  const cwd = opts.cwd || undefined;

  // Create PTY in main process
  const result = await sworm.pty.create({ id, cmd, cwd });

  // Create DOM elements
  const container = document.getElementById('pane-container');

  const paneEl = document.createElement('div');
  paneEl.className = 'pane';
  paneEl.id = `pane-${id}`;
  paneEl.dataset.paneId = id;

  // Label bar
  const label = document.createElement('div');
  label.className = 'pane-label';
  label.innerHTML = `
    <span><span class="pane-number">[${number}]</span> ${name}</span>
    <span style="display:flex;align-items:center;gap:4px">
      <span class="pane-status active"></span>
      <span class="close-btn" data-pane-id="${id}">&times;</span>
    </span>
  `;
  label.addEventListener('click', (e) => {
    if (e.target.classList.contains('close-btn')) {
      killPane(e.target.dataset.paneId);
    } else {
      focusPane(id);
    }
  });

  // Terminal container
  const termEl = document.createElement('div');
  termEl.className = 'pane-terminal';

  paneEl.appendChild(label);
  paneEl.appendChild(termEl);
  container.appendChild(paneEl);

  // Create xterm.js instance
  const terminal = new Terminal({
    theme: {
      background: '#0a0a0a',
      foreground: '#e0e0e0',
      cursor: '#4fc3f7',
      selectionBackground: '#264f78',
      black: '#0a0a0a',
      red: '#f44336',
      green: '#4caf50',
      yellow: '#ffeb3b',
      blue: '#4fc3f7',
      magenta: '#ce93d8',
      cyan: '#80deea',
      white: '#e0e0e0',
    },
    fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 14,
    cursorBlink: true,
    cursorStyle: 'bar',
    allowTransparency: true,
  });

  const fitAddon = new FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);

  terminal.open(termEl);
  fitAddon.fit();

  // Connect terminal input to PTY
  terminal.onData((data) => {
    sworm.pty.write(id, data);
  });

  // Store pane state
  state.panes.set(id, {
    terminal,
    fitAddon,
    number,
    name,
    cmd,
    element: paneEl,
    active: true,
  });

  focusPane(id);
  updateStatusBar();
  updateLayout();

  return id;
}

function killPane(id) {
  const pane = state.panes.get(id);
  if (!pane) return;

  pane.terminal.dispose();
  pane.element.remove();
  state.panes.delete(id);
  sworm.pty.kill(id);

  // Focus another pane
  if (state.focusedPane === id) {
    const remaining = [...state.panes.keys()];
    if (remaining.length > 0) {
      focusPane(remaining[remaining.length - 1]);
    } else {
      state.focusedPane = null;
    }
  }

  updateStatusBar();
  updateLayout();
}

function focusPane(id) {
  // Unfocus all
  for (const [paneId, pane] of state.panes) {
    pane.element.classList.toggle('focused', paneId === id);
  }
  state.focusedPane = id;
  const pane = state.panes.get(id);
  if (pane) {
    pane.terminal.focus();
    pane.fitAddon.fit();
  }
  updateStatusBar();
}

function focusByNumber(n) {
  for (const [id, pane] of state.panes) {
    if (pane.number === n) {
      focusPane(id);
      return;
    }
  }
}

function updateLayout() {
  const count = state.panes.size;
  const panes = [...state.panes.values()];

  if (count === 0) return;

  // Auto-tiling based on pane count
  if (count === 1) {
    panes[0].element.style.width = '100%';
    panes[0].element.style.height = '100%';
  } else if (count === 2) {
    panes.forEach(p => {
      p.element.style.width = 'calc(50% - 1px)';
      p.element.style.height = '100%';
    });
  } else if (count === 3) {
    panes[0].element.style.width = 'calc(50% - 1px)';
    panes[0].element.style.height = '100%';
    panes[1].element.style.width = 'calc(50% - 1px)';
    panes[1].element.style.height = 'calc(50% - 1px)';
    panes[2].element.style.width = 'calc(50% - 1px)';
    panes[2].element.style.height = 'calc(50% - 1px)';
  } else {
    // 4+ panes: equal grid
    const cols = Math.ceil(Math.sqrt(count));
    const w = `calc(${100 / cols}% - ${(cols - 1) * 2 / cols}px)`;
    panes.forEach(p => {
      p.element.style.width = w;
      p.element.style.height = `calc(${100 / Math.ceil(count / cols)}% - 1px)`;
    });
  }

  // Refit all terminals after layout change
  requestAnimationFrame(() => {
    for (const [id, pane] of state.panes) {
      pane.fitAddon.fit();
      const dims = pane.fitAddon.proposeDimensions();
      if (dims) {
        sworm.pty.resize(id, dims.cols, dims.rows);
      }
    }
  });
}

// ─── PTY Data Routing ─────────────────────────────────

sworm.pty.onData((id, data) => {
  const pane = state.panes.get(id);
  if (pane) pane.terminal.write(data);
});

sworm.pty.onExit((id, exitCode) => {
  const pane = state.panes.get(id);
  if (pane) {
    pane.active = false;
    const statusEl = pane.element.querySelector('.pane-status');
    if (statusEl) statusEl.classList.remove('active');
    pane.terminal.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
  }
  updateStatusBar();
});

// ─── Status Bar ───────────────────────────────────────

function updateStatusBar() {
  const bar = document.getElementById('status-bar');
  const activeCount = [...state.panes.values()].filter(p => p.active).length;
  const totalCount = state.panes.size;
  const focused = state.focusedPane ? state.panes.get(state.focusedPane) : null;

  bar.innerHTML = `
    <div class="left">
      <span class="agent-count">${activeCount}/${totalCount} agents</span>
      ${focused ? `<span>focused: [${focused.number}] ${focused.name}</span>` : ''}
    </div>
    <div class="right">
      <span class="shortcut-hint">Ctrl+N new | Ctrl+Space palette | Ctrl+1-9 focus</span>
    </div>
  `;
}

// ─── Command Palette ──────────────────────────────────

const COMMANDS = [
  { label: 'New Agent', description: 'Spawn a Claude Code pane', action: () => createPane() },
  { label: 'New Shell', description: 'Spawn a plain terminal', action: () => createPane({ cmd: '', name: 'shell' }) },
  { label: 'Kill All', description: 'Close all panes', action: () => { for (const id of [...state.panes.keys()]) killPane(id); } },
  { label: 'Split Right', description: 'New agent to the right', action: () => createPane() },
];

function toggleCommandPalette() {
  const el = document.getElementById('command-palette');
  state.commandPaletteOpen = !state.commandPaletteOpen;
  el.classList.toggle('hidden', !state.commandPaletteOpen);

  if (state.commandPaletteOpen) {
    const input = el.querySelector('input');
    input.value = '';
    input.focus();
    state.selectedResultIndex = 0;
    renderPaletteResults('');
  }
}

function renderPaletteResults(query) {
  const resultsEl = document.getElementById('command-palette').querySelector('.results');
  const q = query.toLowerCase();

  // Build results: active panes + commands
  let html = '';

  // Active panes section
  const paneResults = [...state.panes.entries()]
    .filter(([id, p]) => !q || p.name.toLowerCase().includes(q) || String(p.number).includes(q))
    .map(([id, p]) => `
      <div class="result-item" data-action="focus" data-id="${id}">
        <span class="label">[${p.number}] ${p.name}</span>
        <span class="description">${p.active ? 'active' : 'exited'}</span>
      </div>
    `).join('');

  if (paneResults) {
    html += `<div class="section-header">Agents</div>${paneResults}`;
  }

  // Commands section
  const cmdResults = COMMANDS
    .filter(c => !q || c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
    .map((c, i) => `
      <div class="result-item" data-action="command" data-index="${i}">
        <span class="label">${c.label}</span>
        <span class="description">${c.description}</span>
      </div>
    `).join('');

  if (cmdResults) {
    html += `<div class="section-header">Commands</div>${cmdResults}`;
  }

  resultsEl.innerHTML = html;

  // Click handlers
  resultsEl.querySelectorAll('.result-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.action === 'focus') {
        focusPane(item.dataset.id);
      } else if (item.dataset.action === 'command') {
        COMMANDS[parseInt(item.dataset.index)].action();
      }
      toggleCommandPalette();
    });
  });
}

// ─── Keyboard Shortcuts ───────────────────────────────

document.addEventListener('keydown', (e) => {
  // Ctrl+Space: command palette
  if (e.ctrlKey && e.code === 'Space') {
    e.preventDefault();
    toggleCommandPalette();
    return;
  }

  // When command palette is open
  if (state.commandPaletteOpen) {
    if (e.key === 'Escape') {
      toggleCommandPalette();
      return;
    }
    if (e.key === 'Enter') {
      const selected = document.querySelector('#command-palette .result-item.selected')
        || document.querySelector('#command-palette .result-item');
      if (selected) selected.click();
      return;
    }
    return; // Let the input handle other keys
  }

  // Ctrl+N: new agent
  if (e.ctrlKey && !e.shiftKey && e.key === 'n') {
    e.preventDefault();
    createPane();
    return;
  }

  // Ctrl+Shift+N: new shell
  if (e.ctrlKey && e.shiftKey && e.key === 'N') {
    e.preventDefault();
    createPane({ cmd: '', name: 'shell' });
    return;
  }

  // Ctrl+W: close current pane
  if (e.ctrlKey && e.key === 'w') {
    e.preventDefault();
    if (state.focusedPane) killPane(state.focusedPane);
    return;
  }

  // Ctrl+1-9: focus pane by number
  if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
    e.preventDefault();
    focusByNumber(parseInt(e.key));
    return;
  }

  // Ctrl+Tab: cycle panes
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    const ids = [...state.panes.keys()];
    if (ids.length === 0) return;
    const currentIdx = ids.indexOf(state.focusedPane);
    const nextIdx = (currentIdx + 1) % ids.length;
    focusPane(ids[nextIdx]);
    return;
  }
});

// Command palette input handler
document.addEventListener('DOMContentLoaded', () => {
  // Set up command palette HTML
  const palette = document.getElementById('command-palette');
  palette.innerHTML = `
    <input type="text" placeholder="Type a command or agent name..." spellcheck="false" autocomplete="off">
    <div class="results"></div>
  `;

  const input = palette.querySelector('input');
  input.addEventListener('input', () => {
    renderPaletteResults(input.value);
  });
});

// ─── Window Resize ────────────────────────────────────

window.addEventListener('resize', () => {
  updateLayout();
});

// ─── Init ─────────────────────────────────────────────

// Start with one Claude Code pane
window.addEventListener('DOMContentLoaded', async () => {
  updateStatusBar();
  await createPane({ name: 'main', cmd: 'claude' });
});
