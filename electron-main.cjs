/**
 * Electron entry point — bridges ESM to CJS for Electron's main process.
 * Compiles and runs app/main.ts via tsx.
 */
const { execSync, spawn } = require('child_process');
const path = require('path');

// Use tsx to run the TypeScript main process directly
const child = spawn(
  process.execPath,
  ['--import', 'tsx/esm', path.join(__dirname, 'app', 'main.ts')],
  {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  }
);

child.on('exit', (code) => process.exit(code ?? 0));
