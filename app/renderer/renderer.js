// ═══════════════════════════════════════════════════════════
// SWORM RENDERER — Terminal + Widget Pane System
// ═══════════════════════════════════════════════════════════

// Resolve xterm globals (UMD export variations)
const XTerminal = (typeof Terminal !== 'undefined' && Terminal.Terminal) ? Terminal.Terminal : (typeof Terminal !== 'undefined' ? Terminal : null);
const XFitAddon = (typeof FitAddon !== 'undefined' && FitAddon.FitAddon) ? FitAddon.FitAddon : (typeof FitAddon !== 'undefined' ? FitAddon : null);

console.log('[Sworm] API:', window.sworm ? 'OK' : 'MISSING');
console.log('[Sworm] XTerminal:', XTerminal ? 'OK' : 'MISSING');
console.log('[Sworm] XFitAddon:', XFitAddon ? 'OK' : 'MISSING');

// ─── State ────────────────────────────────────────────────
const state = {
  panes: new Map(),
  focusedPane: null,
  paneCounter: 0,
  commandPaletteOpen: false,
  voiceShortcut: null,
};

// ─── Welcome Screen ──────────────────────────────────────
function showWelcome() {
  const container = document.getElementById('pane-container');
  container.innerHTML = `
    <div id="welcome">
      <h1>SWORM</h1>
      <div class="subtitle">terminal + widget pane system</div>
      <div class="actions">
        <button class="action-btn" onclick="createPane({name:'main',cmd:'claude'})">
          <span class="icon">></span> New Agent
        </button>
        <button class="action-btn" onclick="createPane({name:'shell',cmd:''})">
          <span class="icon">$</span> Shell
        </button>
        <button class="action-btn" onclick="createWidgetPane({name:'launcher',widget:'launcher'})">
          <span class="icon">+</span> Launcher
        </button>
        <button class="action-btn" onclick="createWidgetPane({name:'dashboard',widget:'dashboard'})">
          <span class="icon">#</span> Dashboard
        </button>
        <button class="action-btn" onclick="createWidgetPane({name:'settings',widget:'settings'})">
          <span class="icon">*</span> Settings
        </button>
      </div>
      <div class="hint">Ctrl+Space command palette | Ctrl+N new agent</div>
    </div>
  `;
}

// ─── Terminal Pane ────────────────────────────────────────
async function createPane(opts = {}) {
  clearWelcome();
  const number = ++state.paneCounter;
  const id = opts.id || `agent-${number}`;
  const name = opts.name || id;
  const cmd = opts.cmd !== undefined ? opts.cmd : 'claude';
  const cwd = opts.cwd || undefined;

  console.log(`[Sworm] Creating terminal pane: [${number}] ${name} cmd="${cmd}"`);

  // Create PTY
  const result = await window.sworm.pty.create({ id, cmd: cmd || undefined, cwd });
  console.log(`[Sworm] PTY pid=${result.pid}`);

  // Build DOM
  const container = document.getElementById('pane-container');
  const paneEl = document.createElement('div');
  paneEl.className = 'pane';
  paneEl.dataset.paneId = id;

  const label = document.createElement('div');
  label.className = 'pane-label';
  label.innerHTML = `
    <span><span class="pane-number">[${number}]</span> ${name}</span>
    <span style="display:flex;align-items:center;gap:6px">
      <span class="pane-status active"></span>
      <span class="close-btn" data-pane-id="${id}">&times;</span>
    </span>
  `;
  label.addEventListener('click', (e) => {
    if (e.target.classList.contains('close-btn')) killPane(e.target.dataset.paneId);
    else focusPane(id);
  });

  const termEl = document.createElement('div');
  termEl.className = 'pane-terminal';

  paneEl.appendChild(label);
  paneEl.appendChild(termEl);
  container.appendChild(paneEl);

  // Create xterm
  const terminal = new XTerminal({
    theme: {
      background: '#0a0a0a', foreground: '#e0e0e0', cursor: '#4fc3f7',
      selectionBackground: '#264f78',
      black: '#0a0a0a', red: '#f44336', green: '#4caf50', yellow: '#ffeb3b',
      blue: '#4fc3f7', magenta: '#ce93d8', cyan: '#80deea', white: '#e0e0e0',
    },
    fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 14, cursorBlink: true, cursorStyle: 'bar', allowTransparency: true,
  });

  const fitAddon = new XFitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(termEl);

  // Connect input to PTY
  terminal.onData((data) => window.sworm.pty.write(id, data));

  // Auto-resize terminal when pane container changes size
  const resizeObserver = new ResizeObserver(() => {
    try {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims) window.sworm.pty.resize(id, dims.cols, dims.rows);
    } catch {}
  });
  resizeObserver.observe(termEl);

  // Store state
  state.panes.set(id, {
    terminal, fitAddon, number, name, type: 'terminal',
    element: paneEl, active: true, resizeObserver,
  });

  // Layout first, then fit terminal after a frame
  updateLayout();
  focusPane(id);

  // Delayed fit — must happen after layout is computed
  await new Promise(r => setTimeout(r, 100));
  try {
    fitAddon.fit();
    const dims = fitAddon.proposeDimensions();
    if (dims) window.sworm.pty.resize(id, dims.cols, dims.rows);
  } catch (e) {
    console.warn('[Sworm] fit error:', e);
  }

  updateStatusBar();
  return id;
}

// ─── Widget Pane ──────────────────────────────────────────
function createWidgetPane(opts = {}) {
  clearWelcome();
  const number = ++state.paneCounter;
  const id = opts.id || `widget-${number}`;
  const name = opts.name || id;
  const widget = opts.widget || 'launcher';

  console.log(`[Sworm] Creating widget pane: [${number}] ${name} widget=${widget}`);

  const container = document.getElementById('pane-container');
  const paneEl = document.createElement('div');
  paneEl.className = 'pane';
  paneEl.dataset.paneId = id;

  const label = document.createElement('div');
  label.className = 'pane-label';
  label.innerHTML = `
    <span><span class="pane-number">[${number}]</span> ${name}</span>
    <span style="display:flex;align-items:center;gap:6px">
      <span class="pane-status widget"></span>
      <span class="close-btn" data-pane-id="${id}">&times;</span>
    </span>
  `;
  label.addEventListener('click', (e) => {
    if (e.target.classList.contains('close-btn')) killPane(e.target.dataset.paneId);
    else focusPane(id);
  });

  const iframe = document.createElement('iframe');
  iframe.className = 'pane-widget';
  // Load widget from app/widgets/ directory
  const widgetDir = document.location.href.replace(/renderer\/index\.html.*$/, 'widgets/');
  iframe.src = widgetDir + widget + '.html';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

  paneEl.appendChild(label);
  paneEl.appendChild(iframe);
  container.appendChild(paneEl);

  state.panes.set(id, {
    number, name, type: 'widget', widget,
    element: paneEl, active: true, iframe,
  });

  updateLayout();
  focusPane(id);
  updateStatusBar();
  return id;
}

// ─── Pane Management ──────────────────────────────────────
function clearWelcome() {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();
}

function killPane(id) {
  const pane = state.panes.get(id);
  if (!pane) return;
  if (pane.type === 'terminal') {
    if (pane.resizeObserver) pane.resizeObserver.disconnect();
    pane.terminal.dispose();
    window.sworm.pty.kill(id);
  }
  pane.element.remove();
  state.panes.delete(id);

  if (state.focusedPane === id) {
    const remaining = [...state.panes.keys()];
    if (remaining.length > 0) focusPane(remaining[remaining.length - 1]);
    else { state.focusedPane = null; showWelcome(); }
  }
  updateLayout();
  updateStatusBar();
}

function focusPane(id) {
  for (const [pid, pane] of state.panes) {
    pane.element.classList.toggle('focused', pid === id);
  }
  state.focusedPane = id;
  const pane = state.panes.get(id);
  if (pane && pane.type === 'terminal') {
    pane.terminal.focus();
    setTimeout(() => {
      try {
        pane.fitAddon.fit();
        const dims = pane.fitAddon.proposeDimensions();
        if (dims) window.sworm.pty.resize(id, dims.cols, dims.rows);
      } catch {}
    }, 20);
  }
  updateStatusBar();
}

function focusByNumber(n) {
  for (const [id, pane] of state.panes) {
    if (pane.number === n) { focusPane(id); return; }
  }
}

function updateLayout() {
  const count = state.panes.size;
  if (count === 0) return;
  const panes = [...state.panes.values()];

  if (count === 1) {
    panes[0].element.style.width = '100%';
    panes[0].element.style.height = '100%';
  } else if (count === 2) {
    panes.forEach(p => { p.element.style.width = 'calc(50% - 1px)'; p.element.style.height = '100%'; });
  } else if (count === 3) {
    panes[0].element.style.width = 'calc(50% - 1px)'; panes[0].element.style.height = '100%';
    panes[1].element.style.width = 'calc(50% - 1px)'; panes[1].element.style.height = 'calc(50% - 1px)';
    panes[2].element.style.width = 'calc(50% - 1px)'; panes[2].element.style.height = 'calc(50% - 1px)';
  } else {
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    panes.forEach(p => {
      p.element.style.width = `calc(${100/cols}% - ${(cols-1)*2/cols}px)`;
      p.element.style.height = `calc(${100/rows}% - ${(rows-1)*2/rows}px)`;
    });
  }

  // Refit terminals after layout
  requestAnimationFrame(() => {
    for (const [id, pane] of state.panes) {
      if (pane.type === 'terminal') {
        try {
          pane.fitAddon.fit();
          const dims = pane.fitAddon.proposeDimensions();
          if (dims) window.sworm.pty.resize(id, dims.cols, dims.rows);
        } catch {}
      }
    }
  });
}

// ─── PTY Data Routing ─────────────────────────────────────
window.sworm.pty.onData((id, data) => {
  const pane = state.panes.get(id);
  if (pane && pane.type === 'terminal') pane.terminal.write(data);
});

window.sworm.pty.onExit((id, exitCode) => {
  const pane = state.panes.get(id);
  if (pane) {
    pane.active = false;
    const s = pane.element.querySelector('.pane-status');
    if (s) s.classList.remove('active');
    if (pane.type === 'terminal') {
      pane.terminal.write(`\r\n\x1b[90m[exited: ${exitCode}]\x1b[0m\r\n`);
    }
  }
  updateStatusBar();
});

// ─── Widget Message Bridge ────────────────────────────────
window.addEventListener('message', async (e) => {
  if (!e.data || !e.data.type) return;
  console.log('[Sworm] Widget message:', e.data);
  switch (e.data.type) {
    case 'launch':
      if (window.sworm.app) window.sworm.app.launch({ exe: e.data.app, args: e.data.args });
      break;
    case 'sworm-command':
      handleCommand(e.data.cmd);
      break;
    case 'new-agent':
      createPane({ name: e.data.name, cmd: e.data.cmd || 'claude' });
      break;
    case 'settings-request': {
      // Settings widget requesting current settings
      const settings = await window.sworm.settings.read();
      // Find the settings iframe and send data back
      for (const [, pane] of state.panes) {
        if (pane.type === 'widget' && pane.widget === 'settings' && pane.iframe) {
          pane.iframe.contentWindow.postMessage({ type: 'settings-data', settings }, '*');
        }
      }
      break;
    }
    case 'settings-save': {
      // Settings widget saving settings
      const result = await window.sworm.settings.write(e.data.settings);
      for (const [, pane] of state.panes) {
        if (pane.type === 'widget' && pane.widget === 'settings' && pane.iframe) {
          pane.iframe.contentWindow.postMessage({
            type: result.ok ? 'settings-saved' : 'settings-error',
            error: result.error,
          }, '*');
        }
      }
      break;
    }
  }
});

function handleCommand(cmd) {
  if (cmd === 'new agent') createPane();
  else if (cmd === 'new shell') createPane({ name: 'shell', cmd: '' });
  else if (cmd === 'new launcher') createWidgetPane({ name: 'launcher', widget: 'launcher' });
  else if (cmd === 'kill all') { for (const id of [...state.panes.keys()]) killPane(id); }
}

function executeVoiceCommand(text) {
  const t = text.toLowerCase().trim();
  console.log('[Voice] Executing:', t);

  // New windows/panes
  if (t.match(/\b(open|new|create|start|launch)\b.*\b(agent|claude)\b/i)) {
    const count = t.match(/(\d+|two|three|four|five)/i);
    const n = count ? parseWordNumber(count[1]) : 1;
    for (let i = 0; i < n; i++) createPane();
    return;
  }
  if (t.match(/\b(open|new|create|start|launch)\b.*\b(shell|terminal)\b/i)) {
    const count = t.match(/(\d+|two|three|four|five)/i);
    const n = count ? parseWordNumber(count[1]) : 1;
    for (let i = 0; i < n; i++) createPane({ name: 'shell', cmd: '' });
    return;
  }
  if (t.match(/\b(open|new|create)\b.*\b(window|pane)\b/i)) {
    const count = t.match(/(\d+|two|three|four|five)/i);
    const n = count ? parseWordNumber(count[1]) : 1;
    for (let i = 0; i < n; i++) createPane();
    return;
  }
  if (t.match(/\b(open|show)\b.*\bsetting/i)) {
    createWidgetPane({ name: 'settings', widget: 'settings' });
    return;
  }
  if (t.match(/\b(open|show)\b.*\b(launcher|dashboard)\b/i)) {
    const widget = t.match(/launcher/i) ? 'launcher' : 'dashboard';
    createWidgetPane({ name: widget, widget });
    return;
  }

  // Kill/close
  if (t.match(/\b(kill|close|remove)\b.*\ball\b/i)) {
    for (const id of [...state.panes.keys()]) killPane(id);
    return;
  }
  if (t.match(/\b(kill|close|remove)\b.*\b(this|current|focused)\b/i)) {
    if (state.focusedPane) killPane(state.focusedPane);
    return;
  }

  // Focus
  if (t.match(/\bfocus\b.*(\d+)/i)) {
    const m = t.match(/(\d+)/);
    if (m) focusByNumber(parseInt(m[1]));
    return;
  }

  // Fallback — just log it
  console.log('[Voice] Unrecognized command:', t);
}

function parseWordNumber(w) {
  const map = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  return map[w.toLowerCase()] || parseInt(w) || 1;
}

// ─── Status Bar ───────────────────────────────────────────
function updateStatusBar() {
  const bar = document.getElementById('status-bar');
  const terminals = [...state.panes.values()].filter(p => p.type === 'terminal');
  const widgets = [...state.panes.values()].filter(p => p.type === 'widget');
  const focused = state.focusedPane ? state.panes.get(state.focusedPane) : null;

  bar.innerHTML = `
    <div class="left">
      <span class="agent-count">${terminals.length} agents ${widgets.length ? `| ${widgets.length} widgets` : ''}</span>
      ${focused ? `<span>[${focused.number}] ${focused.name}</span>` : ''}
    </div>
    <div class="right">
      <span class="shortcut-hint">${state.voiceShortcut ? state.voiceShortcut + ' voice | ' : ''}Ctrl+N agent | Ctrl+Space palette</span>
    </div>
  `;
}

// ─── Command Palette ──────────────────────────────────────
const COMMANDS = [
  { label: 'New Agent', desc: 'Claude Code terminal', fn: () => createPane() },
  { label: 'New Shell', desc: 'Plain terminal', fn: () => createPane({ name: 'shell', cmd: '' }) },
  { label: 'Launcher', desc: 'App launcher widget', fn: () => createWidgetPane({ name: 'launcher', widget: 'launcher' }) },
  { label: 'Dashboard', desc: 'Agent dashboard widget', fn: () => createWidgetPane({ name: 'dashboard', widget: 'dashboard' }) },
  { label: 'Settings', desc: 'Voice, hotkeys, and general settings', fn: () => createWidgetPane({ name: 'settings', widget: 'settings' }) },
  { label: 'Kill All', desc: 'Close all panes', fn: () => { for (const id of [...state.panes.keys()]) killPane(id); } },
];

function toggleCommandPalette() {
  state.commandPaletteOpen = !state.commandPaletteOpen;
  const el = document.getElementById('command-palette');
  el.classList.toggle('hidden', !state.commandPaletteOpen);
  if (state.commandPaletteOpen) {
    const input = el.querySelector('input');
    if (input) { input.value = ''; input.focus(); }
    renderPaletteResults('');
  }
}

function renderPaletteResults(query) {
  const el = document.getElementById('command-palette');
  const resultsEl = el.querySelector('.results');
  if (!resultsEl) return;
  const q = query.toLowerCase();
  let html = '';

  // Active panes
  const paneHtml = [...state.panes.entries()]
    .filter(([, p]) => !q || p.name.includes(q) || String(p.number).includes(q))
    .map(([id, p]) => `<div class="result-item" data-action="focus" data-id="${id}">
      <span class="label">[${p.number}] ${p.name}</span>
      <span class="description">${p.type} ${p.active ? '●' : '○'}</span>
    </div>`).join('');
  if (paneHtml) html += `<div class="section-header">Active Panes</div>${paneHtml}`;

  // Commands
  const cmdHtml = COMMANDS
    .filter(c => !q || c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q))
    .map((c, i) => `<div class="result-item" data-action="cmd" data-idx="${i}">
      <span class="label">${c.label}</span>
      <span class="description">${c.desc}</span>
    </div>`).join('');
  if (cmdHtml) html += `<div class="section-header">Commands</div>${cmdHtml}`;

  resultsEl.innerHTML = html;
  resultsEl.querySelectorAll('.result-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.action === 'focus') focusPane(item.dataset.id);
      else if (item.dataset.action === 'cmd') COMMANDS[parseInt(item.dataset.idx)].fn();
      toggleCommandPalette();
    });
  });
}

// ─── Keyboard Shortcuts ───────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.code === 'Space') { e.preventDefault(); toggleCommandPalette(); return; }

  if (state.commandPaletteOpen) {
    if (e.key === 'Escape') { toggleCommandPalette(); return; }
    if (e.key === 'Enter') {
      const item = document.querySelector('#command-palette .result-item');
      if (item) item.click();
      return;
    }
    return;
  }

  if (e.ctrlKey && !e.shiftKey && e.key === 'n') { e.preventDefault(); createPane(); return; }
  if (e.ctrlKey && e.shiftKey && e.key === 'N') { e.preventDefault(); createPane({ name: 'shell', cmd: '' }); return; }
  if (e.ctrlKey && e.key === 'w') { e.preventDefault(); if (state.focusedPane) killPane(state.focusedPane); return; }
  if (e.ctrlKey && e.key >= '1' && e.key <= '9') { e.preventDefault(); focusByNumber(parseInt(e.key)); return; }
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    const ids = [...state.panes.keys()];
    if (ids.length === 0) return;
    const idx = ids.indexOf(state.focusedPane);
    focusPane(ids[(idx + 1) % ids.length]);
    return;
  }
});

// ─── Voice Indicator ─────────────────────────────────────
function initVoice() {
  const overlay = document.createElement('div');
  overlay.id = 'voice-overlay';
  overlay.className = 'voice-overlay hidden';
  overlay.innerHTML = '<div class="voice-dot"></div><span class="voice-label">Listening...</span>';
  document.body.appendChild(overlay);

  window.sworm.voice.onStatus((status, message) => {
    console.log('[Voice]', status, message);
    const el = document.getElementById('voice-overlay');
    if (!el) return;
    const dot = el.querySelector('.voice-dot');
    const label = el.querySelector('.voice-label');

    switch (status) {
      case 'listening':
        el.classList.remove('hidden');
        label.textContent = 'Listening...';
        dot.className = 'voice-dot recording';
        break;
      case 'processing':
        el.classList.remove('hidden');
        label.textContent = 'Processing...';
        dot.className = 'voice-dot processing';
        break;
      case 'error':
        el.classList.remove('hidden');
        label.textContent = message || 'Error';
        dot.className = 'voice-dot error';
        setTimeout(() => el.classList.add('hidden'), 3000);
        break;
      case 'idle':
        el.classList.add('hidden');
        break;
    }
  });

  window.sworm.voice.onResult((text) => {
    console.log('[Voice] Result:', text);
    const el = document.getElementById('voice-overlay');
    if (el) {
      el.classList.remove('hidden');
      el.querySelector('.voice-label').textContent = '"' + text + '"';
      el.querySelector('.voice-dot').className = 'voice-dot success';
      setTimeout(() => el.classList.add('hidden'), 3000);
    }
    // Execute the voice command
    executeVoiceCommand(text);
  });

  window.sworm.voice.onShortcut((shortcut) => {
    state.voiceShortcut = shortcut;
    updateStatusBar();
    // Update welcome hint if visible
    const hint = document.querySelector('#welcome .hint');
    if (hint) hint.textContent = `${shortcut} voice | Ctrl+Space palette | Ctrl+N new agent`;
  });
}

// ─── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Set up command palette HTML
  const palette = document.getElementById('command-palette');
  palette.innerHTML = '<input type="text" placeholder="Type a command..." spellcheck="false" autocomplete="off"><div class="results"></div>';
  palette.querySelector('input').addEventListener('input', (e) => renderPaletteResults(e.target.value));

  // Init voice indicator
  initVoice();

  // Show welcome screen
  updateStatusBar();
  showWelcome();
});

// Debounced resize — refit all terminal panes when window resizes
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    updateLayout();
    // Double-fit after a frame to catch any layout shifts
    requestAnimationFrame(() => {
      for (const [id, pane] of state.panes) {
        if (pane.type === 'terminal') {
          try {
            pane.fitAddon.fit();
            const dims = pane.fitAddon.proposeDimensions();
            if (dims) window.sworm.pty.resize(id, dims.cols, dims.rows);
          } catch {}
        }
      }
    });
  }, 100);
});
