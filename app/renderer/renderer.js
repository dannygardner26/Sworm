// ═══════════════════════════════════════════════════════════
// SWORM RENDERER — Spark Input + Terminal Pane System
// ═══════════════════════════════════════════════════════════

const XTerminal = (typeof Terminal !== 'undefined' && Terminal.Terminal) ? Terminal.Terminal : (typeof Terminal !== 'undefined' ? Terminal : null);
const XFitAddon = (typeof FitAddon !== 'undefined' && FitAddon.FitAddon) ? FitAddon.FitAddon : (typeof FitAddon !== 'undefined' ? FitAddon : null);

// ─── State ────────────────────────────────────────────────
const state = {
  panes: new Map(),
  focusedPane: null,
  paneCounter: 0,
  commandPaletteOpen: false,
  voiceShortcut: null,
  voiceCommand: false,
  sparkMode: true,
  inputText: '',
};

// ═══════════════════════════════════════════════════════════
// SPARK PARTICLE SYSTEM
// ═══════════════════════════════════════════════════════════

const canvas = document.getElementById('spark-canvas');
const ctx = canvas.getContext('2d');
const particles = [];

function resizeCanvas() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.scale(devicePixelRatio, devicePixelRatio);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const SPARK_COLORS = [
  '#4fc3f7', '#81d4fa', '#b3e5fc',
  '#fff',
  '#ffcc80', '#ffab40',
  '#ce93d8',
];

function spawnSparks(x, y, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 5;
    const size = 1.5 + Math.random() * 3;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.5,
      size,
      life: 1,
      decay: 0.012 + Math.random() * 0.02,
      color: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
      gravity: 0.04 + Math.random() * 0.03,
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.vx *= 0.98;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  ctx.clearRect(0, 0, canvas.width / devicePixelRatio, canvas.height / devicePixelRatio);
  for (const p of particles) {
    ctx.globalAlpha = p.life * p.life;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = p.size * 6 * p.life;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
    // Bright white core
    ctx.globalAlpha = p.life;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.fillStyle = p.color;
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function animationLoop() {
  updateParticles();
  drawParticles();
  requestAnimationFrame(animationLoop);
}
requestAnimationFrame(animationLoop);

// ─── Spark Input ─────────────────────────────────────────

function renderSparkText() {
  const el = document.getElementById('spark-text');
  const cursor = '<span id="spark-cursor"></span>';
  let html = '';
  for (let i = 0; i < state.inputText.length; i++) {
    const ch = state.inputText[i] === ' ' ? '&nbsp;' : escapeHtml(state.inputText[i]);
    html += `<span class="spark-char">${ch}</span>`;
  }
  html += cursor;
  el.innerHTML = html;

  const hint = document.getElementById('spark-hint');
  if (hint) hint.style.opacity = state.inputText.length === 0 ? '1' : '0';
}

function escapeHtml(ch) {
  if (ch === '<') return '&lt;';
  if (ch === '>') return '&gt;';
  if (ch === '&') return '&amp;';
  return ch;
}

function getCharPosition() {
  const cursor = document.getElementById('spark-cursor');
  if (!cursor) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const rect = cursor.getBoundingClientRect();
  return { x: rect.left, y: rect.top + rect.height / 2 };
}

function handleSparkKey(e) {
  if (!state.sparkMode) return;
  if (state.commandPaletteOpen) return;
  if (['Control', 'Shift', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;

  if (e.ctrlKey && e.key === 'k') { e.preventDefault(); toggleCommandPalette(); return; }
  if (e.ctrlKey && e.key === 'n') { e.preventDefault(); executeSparkCommand('agent'); return; }

  if (e.key === 'Escape') {
    e.preventDefault();
    state.inputText = '';
    renderSparkText();
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    if (state.inputText.trim()) {
      const pos = getCharPosition();
      spawnSparks(pos.x, pos.y, 40);
      executeSparkCommand(state.inputText.trim());
      state.inputText = '';
      renderSparkText();
    }
    return;
  }

  if (e.key === 'Backspace') {
    e.preventDefault();
    if (state.inputText.length > 0) {
      const pos = getCharPosition();
      spawnSparks(pos.x, pos.y, 6);
      state.inputText = state.inputText.slice(0, -1);
      renderSparkText();
    }
    return;
  }

  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    state.inputText += e.key;
    renderSparkText();
    const pos = getCharPosition();
    spawnSparks(pos.x, pos.y, 8 + Math.floor(Math.random() * 8));
  }
}

function parseCount(text) {
  const wordMap = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const numMatch = text.match(/(\d+)/);
  if (numMatch) return parseInt(numMatch[1]);
  for (const [word, n] of Object.entries(wordMap)) {
    if (text.includes(word)) return n;
  }
  return 1;
}

function executeSparkCommand(text) {
  const t = text.toLowerCase().trim();

  // Agent / Claude
  if (t.match(/\b(agent|claude|tab|pane|window)\b/i) && !t.match(/\b(shell|terminal|setting|launch|dash)\b/i)) {
    const count = parseCount(t);
    enterPaneMode();
    for (let i = 0; i < count; i++) createPane();
    return;
  }

  // Shell / Terminal
  if (t.match(/\b(shell|terminal)\b/i)) {
    const count = parseCount(t);
    enterPaneMode();
    for (let i = 0; i < count; i++) createPane({ name: 'shell', cmd: '' });
    return;
  }

  // Widgets
  if (t.match(/\bsetting/i)) { enterPaneMode(); createWidgetPane({ name: 'settings', widget: 'settings' }); return; }
  if (t.match(/\blaunch/i)) { enterPaneMode(); createWidgetPane({ name: 'launcher', widget: 'launcher' }); return; }
  if (t.match(/\bdash/i)) { enterPaneMode(); createWidgetPane({ name: 'dashboard', widget: 'dashboard' }); return; }

  // Kill
  if (t.match(/\b(kill|close|quit|exit)\b.*\ball\b/i)) {
    for (const id of [...state.panes.keys()]) killPane(id);
    return;
  }

  // Unrecognized command — send to brain for AI interpretation
  window.sworm.brain.process(text).catch(() => {});
}

function enterPaneMode() {
  state.sparkMode = false;
  document.getElementById('spark-input-wrap').style.display = 'none';
  document.getElementById('spark-canvas').style.display = 'none';
  document.getElementById('spark-settings').style.display = 'none';
  document.getElementById('pane-container').classList.add('active');
  document.getElementById('status-bar').classList.add('active');
  updateStatusBar();
}

function exitPaneMode() {
  state.sparkMode = true;
  document.getElementById('spark-input-wrap').style.display = '';
  document.getElementById('spark-canvas').style.display = '';
  document.getElementById('spark-settings').style.display = '';
  document.getElementById('pane-container').classList.remove('active');
  document.getElementById('status-bar').classList.remove('active');
  state.inputText = '';
  renderSparkText();
}

// ═══════════════════════════════════════════════════════════
// TERMINAL PANE SYSTEM
// ═══════════════════════════════════════════════════════════

async function createPane(opts = {}) {
  const number = ++state.paneCounter;
  const id = opts.id || `agent-${number}`;
  const name = opts.name || id;
  const cmd = opts.cmd !== undefined ? opts.cmd : 'claude';
  const cwd = opts.cwd || undefined;

  const result = await window.sworm.pty.create({ id, cmd: cmd || undefined, cwd });

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
  terminal.onData((data) => window.sworm.pty.write(id, data));

  const resizeObserver = new ResizeObserver(() => {
    try {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims) window.sworm.pty.resize(id, dims.cols, dims.rows);
    } catch {}
  });
  resizeObserver.observe(termEl);

  state.panes.set(id, {
    terminal, fitAddon, number, name, type: 'terminal',
    element: paneEl, active: true, resizeObserver,
  });

  updateLayout();
  focusPane(id);

  await new Promise(r => setTimeout(r, 100));
  try {
    fitAddon.fit();
    const dims = fitAddon.proposeDimensions();
    if (dims) window.sworm.pty.resize(id, dims.cols, dims.rows);
  } catch {}

  updateStatusBar();
  return id;
}

function createWidgetPane(opts = {}) {
  const number = ++state.paneCounter;
  const id = opts.id || `widget-${number}`;
  const name = opts.name || id;
  const widget = opts.widget || 'launcher';

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
    else { state.focusedPane = null; exitPaneMode(); }
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
  switch (e.data.type) {
    case 'launch':
      if (window.sworm.app) window.sworm.app.launch({ exe: e.data.app, args: e.data.args });
      break;
    case 'sworm-command':
      executeSparkCommand(e.data.cmd);
      break;
    case 'new-agent':
      enterPaneMode();
      createPane({ name: e.data.name, cmd: e.data.cmd || 'claude' });
      break;
    case 'settings-request': {
      const settings = await window.sworm.settings.read();
      for (const [, pane] of state.panes) {
        if (pane.type === 'widget' && pane.widget === 'settings' && pane.iframe) {
          pane.iframe.contentWindow.postMessage({ type: 'settings-data', settings }, '*');
        }
      }
      break;
    }
    case 'settings-save': {
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
      <span class="shortcut-hint">${state.voiceShortcut && state.voiceShortcut !== 'no shortcuts available' ? state.voiceShortcut : 'Esc back'}</span>
    </div>
  `;
}

// ─── Command Palette ──────────────────────────────────────
const COMMANDS = [
  { label: 'New Agent', desc: 'Claude Code terminal', fn: () => { enterPaneMode(); createPane(); } },
  { label: 'New Shell', desc: 'Plain terminal', fn: () => { enterPaneMode(); createPane({ name: 'shell', cmd: '' }); } },
  { label: 'Launcher', desc: 'App launcher widget', fn: () => { enterPaneMode(); createWidgetPane({ name: 'launcher', widget: 'launcher' }); } },
  { label: 'Dashboard', desc: 'Agent dashboard', fn: () => { enterPaneMode(); createWidgetPane({ name: 'dashboard', widget: 'dashboard' }); } },
  { label: 'Settings', desc: 'Voice, hotkeys, general', fn: () => { enterPaneMode(); createWidgetPane({ name: 'settings', widget: 'settings' }); } },
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

  const paneHtml = [...state.panes.entries()]
    .filter(([, p]) => !q || p.name.includes(q) || String(p.number).includes(q))
    .map(([id, p]) => `<div class="result-item" data-action="focus" data-id="${id}">
      <span class="label">[${p.number}] ${p.name}</span>
      <span class="description">${p.type} ${p.active ? '\u25cf' : '\u25cb'}</span>
    </div>`).join('');
  if (paneHtml) html += `<div class="section-header">Active Panes</div>${paneHtml}`;

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
  if (e.ctrlKey && e.key === 'k') { e.preventDefault(); toggleCommandPalette(); return; }

  if (state.commandPaletteOpen) {
    if (e.key === 'Escape') { toggleCommandPalette(); return; }
    if (e.key === 'Enter') {
      const item = document.querySelector('#command-palette .result-item');
      if (item) item.click();
      return;
    }
    return;
  }

  if (state.sparkMode) { handleSparkKey(e); return; }

  if (e.key === 'Escape' && !state.sparkMode && state.panes.size === 0) { exitPaneMode(); return; }
  if (e.ctrlKey && !e.shiftKey && e.key === 'n') { e.preventDefault(); createPane(); return; }
  if (e.ctrlKey && e.shiftKey && e.key === 'N') { e.preventDefault(); createPane({ name: 'shell', cmd: '' }); return; }
  if (e.ctrlKey && e.key === 'w') { e.preventDefault(); if (state.focusedPane) killPane(state.focusedPane); return; }
  if (e.ctrlKey && e.key >= '1' && e.key <= '9') { e.preventDefault(); focusByNumber(parseInt(e.key)); return; }
});

// ─── Audio Synth (Web Audio API) ─────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq, duration, opts = {}) {
  const { type = 'sine', gain = 0.15, delay = 0, detune = 0 } = opts;
  const t = audioCtx.currentTime + delay;

  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (detune) osc.detune.setValueAtTime(detune, t);

  // Smooth ADSR envelope
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.02);     // attack
  g.gain.linearRampToValueAtTime(gain * 0.7, t + 0.06); // decay
  g.gain.setValueAtTime(gain * 0.7, t + duration - 0.05); // sustain
  g.gain.linearRampToValueAtTime(0, t + duration);     // release

  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + duration);
}

function playListeningSound() {
  // Gentle ascending chime — two soft tones
  playTone(523, 0.12, { gain: 0.12 });                    // C5
  playTone(659, 0.15, { delay: 0.1, gain: 0.14 });        // E5
  playTone(784, 0.18, { delay: 0.2, gain: 0.10, detune: 5 }); // G5 (slight shimmer)
}

function playAcknowledgeSound() {
  // Soft descending confirmation
  playTone(784, 0.1, { gain: 0.10 });                     // G5
  playTone(659, 0.12, { delay: 0.08, gain: 0.12 });       // E5
  playTone(523, 0.2, { delay: 0.16, gain: 0.08 });        // C5 (longer tail)
}

function playErrorSound() {
  // Low muted buzz
  playTone(220, 0.2, { type: 'triangle', gain: 0.08 });
  playTone(208, 0.2, { type: 'triangle', gain: 0.06, delay: 0.02 }); // slight dissonance
}

// ─── Voice Action Descriptions ───────────────────────────
function describeAction(text) {
  const t = text.toLowerCase();
  const count = parseCount(t);
  if (t.match(/\b(kill|close|quit|exit)\b.*\ball\b/)) return 'Closing all panes...';
  if (t.match(/\b(kill|close|quit|exit)\b/)) return 'Closing pane...';
  if (t.match(/\b(shell|terminal)\b/)) return `Spawning ${count > 1 ? count + ' ' : ''}shell${count > 1 ? 's' : ''}...`;
  if (t.match(/\b(agent|claude|tab|pane|window)\b/) && !t.match(/\b(shell|terminal|setting|launch|dash)\b/)) return `Spawning ${count > 1 ? count + ' ' : ''}agent${count > 1 ? 's' : ''}...`;
  if (t.match(/\bsetting/)) return 'Opening settings...';
  if (t.match(/\blaunch/)) return 'Opening launcher...';
  if (t.match(/\bdash/)) return 'Opening dashboard...';
  return 'Executing...';
}

function describeResult(text) {
  const t = text.toLowerCase();
  const count = parseCount(t);
  if (t.match(/\b(kill|close|quit|exit)\b.*\ball\b/)) return 'Closed all panes';
  if (t.match(/\b(kill|close|quit|exit)\b/)) return 'Pane closed';
  if (t.match(/\b(shell|terminal)\b/)) return `Opened ${count} shell${count > 1 ? 's' : ''}`;
  if (t.match(/\b(agent|claude|tab|pane|window)\b/) && !t.match(/\b(shell|terminal|setting|launch|dash)\b/)) return `Opened ${count} agent${count > 1 ? 's' : ''}`;
  if (t.match(/\bsetting/)) return 'Settings opened';
  if (t.match(/\blaunch/)) return 'Launcher opened';
  if (t.match(/\bdash/)) return 'Dashboard opened';
  return 'Done';
}

// ─── Brain Chat Feed ─────────────────────────────────────
let chatFadeTimer = null;

function addChatMessage(type, text) {
  const feed = document.getElementById('brain-chat');
  if (!feed) return null;

  // Show the feed
  feed.classList.remove('faded');
  feed.style.display = 'flex';

  const msg = document.createElement('div');
  msg.className = `chat-msg ${type}`;
  msg.textContent = text;
  feed.appendChild(msg);

  // Scroll to bottom (newest at bottom, pushes old up)
  feed.scrollTop = feed.scrollHeight;

  // Limit to last 20 messages
  while (feed.children.length > 20) feed.removeChild(feed.firstChild);

  return msg;
}

function fadeChatFeed() {
  const feed = document.getElementById('brain-chat');
  if (feed) feed.classList.add('faded');
}

// ─── Voice ───────────────────────────────────────────────
let micStream = null;
let micAnalyser = null;
let micAnimFrame = null;

function startMicVisualizer() {
  const canvas = document.getElementById('voice-waveform');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    micStream = stream;
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    micAnalyser = audioCtx.createAnalyser();
    micAnalyser.fftSize = 128;
    source.connect(micAnalyser);

    const bufLen = micAnalyser.frequencyBinCount;
    const data = new Uint8Array(bufLen);

    function draw() {
      micAnimFrame = requestAnimationFrame(draw);
      micAnalyser.getByteFrequencyData(data);

      canvas.width = canvas.offsetWidth * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const bars = 24;
      const barW = canvas.width / bars;
      const step = Math.floor(bufLen / bars);

      for (let i = 0; i < bars; i++) {
        const val = data[i * step] / 255;
        const h = Math.max(2, val * canvas.height * 0.9);
        const y = (canvas.height - h) / 2;

        ctx.fillStyle = val > 0.5 ? '#4fc3f7' : val > 0.2 ? 'rgba(79,195,247,0.6)' : 'rgba(79,195,247,0.25)';
        ctx.fillRect(i * barW + 1, y, barW - 2, h);
      }
    }
    draw();
  }).catch(() => {});
}

function stopMicVisualizer() {
  if (micAnimFrame) { cancelAnimationFrame(micAnimFrame); micAnimFrame = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  micAnalyser = null;
}

function initVoice() {
  // Voice overlay (for listening state)
  const overlay = document.createElement('div');
  overlay.id = 'voice-overlay';
  overlay.className = 'voice-overlay hidden';
  overlay.innerHTML = '<div class="voice-dot"></div><canvas id="voice-waveform"></canvas><span class="voice-label">Listening...</span>';
  document.body.appendChild(overlay);

  // Brain chat feed — scrolling conversation in center of screen
  const chatFeed = document.createElement('div');
  chatFeed.id = 'brain-chat';
  chatFeed.className = 'brain-chat';
  document.body.appendChild(chatFeed);

  window.sworm.voice.onStatus((status, message) => {
    const el = document.getElementById('voice-overlay');
    if (!el) return;
    const dot = el.querySelector('.voice-dot');
    const label = el.querySelector('.voice-label');
    switch (status) {
      case 'listening':
        el.classList.remove('hidden');
        label.textContent = 'Listening...';
        dot.className = 'voice-dot recording';
        startMicVisualizer();
        playListeningSound();
        break;
      case 'processing':
        el.classList.remove('hidden');
        label.textContent = 'Transcribing...';
        dot.className = 'voice-dot processing';
        stopMicVisualizer();
        playAcknowledgeSound();
        break;
      case 'error':
        el.classList.remove('hidden');
        label.textContent = message || 'Error';
        dot.className = 'voice-dot error';
        stopMicVisualizer();
        playErrorSound();
        setTimeout(() => el.classList.add('hidden'), 3000);
        break;
      case 'idle':
        stopMicVisualizer();
        el.classList.add('hidden');
        break;
    }
  });

  // Voice results go through the LLM brain
  window.sworm.voice.onResult((text) => {
    addChatMessage('user', '"' + text + '"');
    window.sworm.brain.process(text).then(result => {
      if (result.error) addChatMessage('error', result.error);
    });
  });

  // Brain status updates → chat feed
  let thinkingEl = null;
  window.sworm.brain.onStatus((type, detail) => {
    switch (type) {
      case 'thinking':
        thinkingEl = addChatMessage('thinking', 'Thinking...');
        break;
      case 'tool-call':
        if (thinkingEl) {
          thinkingEl.textContent = detail || 'Executing...';
          thinkingEl.className = 'chat-msg tool';
        } else {
          addChatMessage('tool', detail || 'Executing...');
        }
        break;
      case 'result':
        if (thinkingEl) thinkingEl.remove();
        thinkingEl = null;
        addChatMessage('assistant', detail || 'Done');
        // Auto-fade chat after 5 seconds of inactivity
        clearTimeout(chatFadeTimer);
        chatFadeTimer = setTimeout(() => fadeChatFeed(), 5000);
        break;
      case 'error':
        if (thinkingEl) thinkingEl.remove();
        thinkingEl = null;
        addChatMessage('error', detail || 'Error');
        playErrorSound();
        break;
    }
  });

  // Brain pane query — respond with current pane state
  window.sworm.brain.onGetPanes((replyChannel) => {
    const panes = [...state.panes.entries()].map(([id, p]) => ({
      id, name: p.name, number: p.number, type: p.type || 'terminal',
    }));
    window.sworm.brain.replyPanes(replyChannel, panes);
  });

  window.sworm.voice.onShortcut((shortcut) => {
    state.voiceShortcut = shortcut;
    updateStatusBar();
    const hint = document.getElementById('spark-hint');
    if (hint) {
      if (shortcut && shortcut !== 'no shortcuts available') {
        hint.innerHTML = shortcut.split(' | ').map(s => {
          const [key, ...rest] = s.split(' ');
          return `<span class="hint-key">${key}</span> ${rest.join(' ')}`;
        }).join('<span class="hint-sep">&middot;</span>');
      }
    }
  });

  window.sworm.voice.ready();
}

// ─── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const palette = document.getElementById('command-palette');
  palette.innerHTML = '<input type="text" placeholder="Type a command..." spellcheck="false" autocomplete="off"><div class="results"></div>';
  palette.querySelector('input').addEventListener('input', (e) => renderPaletteResults(e.target.value));

  initVoice();
  renderSparkText();

  document.getElementById('spark-settings')?.addEventListener('click', () => {
    enterPaneMode();
    createWidgetPane({ name: 'settings', widget: 'settings' });
  });
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    updateLayout();
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
