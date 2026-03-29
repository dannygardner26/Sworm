/**
 * PTY Server — runs as a child process of Electron using system Node.
 * Communicates via stdin/stdout JSON messages to avoid node-pty ABI mismatch.
 */
const pty = require('node-pty');
const ptys = new Map();

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (e) {
      send({ type: 'error', error: e.message });
    }
  }
});

function handleMessage(msg) {
  switch (msg.type) {
    case 'create': {
      const { id, cmd, args, cwd, cols, rows } = msg;
      const shell = cmd || (process.platform === 'win32' ? process.env.COMSPEC || 'powershell.exe' : process.env.SHELL || '/bin/bash');

      let shellCmd, shellArgs;
      if (shell === 'claude' || shell.startsWith('claude ')) {
        const defaultShell = process.platform === 'win32' ? (process.env.COMSPEC || 'powershell.exe') : (process.env.SHELL || '/bin/bash');
        shellCmd = defaultShell;
        shellArgs = defaultShell.includes('powershell')
          ? ['-NoExit', '-Command', shell]
          : defaultShell.includes('cmd')
            ? ['/k', shell]
            : ['-c', shell];
      } else {
        shellCmd = shell;
        shellArgs = args || [];
      }

      const p = pty.spawn(shellCmd, shellArgs, {
        name: 'xterm-256color',
        cols: cols || 120,
        rows: rows || 30,
        cwd: cwd || require('os').homedir(),
        env: { ...process.env, SWORM_PANE_ID: id },
      });

      ptys.set(id, p);

      p.onData((data) => {
        send({ type: 'data', id, data });
      });

      p.onExit(({ exitCode }) => {
        send({ type: 'exit', id, exitCode });
        ptys.delete(id);
      });

      send({ type: 'created', id, pid: p.pid });
      break;
    }

    case 'write': {
      const p = ptys.get(msg.id);
      if (p) p.write(msg.data);
      break;
    }

    case 'resize': {
      const p = ptys.get(msg.id);
      if (p) p.resize(msg.cols, msg.rows);
      break;
    }

    case 'kill': {
      const p = ptys.get(msg.id);
      if (p) {
        p.kill();
        ptys.delete(msg.id);
      }
      break;
    }
  }
}

send({ type: 'ready' });
